import {
  BadRequestException,
  HttpException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { OrigemAtendimento } from '../../common/enums/origem-atendimento.enum';
import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { StatusAtendimento } from '../../common/enums/status-atendimento.enum';
import { StatusInscricao } from '../../common/enums/status-inscricao.enum';
import { StatusParticipacao } from '../../common/enums/status-participacao.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { mensagemDeConstraint } from '../../common/filters/todas-excecoes.filter';
import { DisponibilidadesService } from '../disponibilidades/disponibilidades.service';
import { AtendimentoRealizadoEvento, EVENTO_ATENDIMENTO_REALIZADO } from '../gamificacao/eventos';
import {
  AtendimentoAgendadoEvento,
  AtendimentoCanceladoEvento,
  AtendimentoReagendadoEvento,
  EVENTO_ATENDIMENTO_AGENDADO,
  EVENTO_ATENDIMENTO_CANCELADO,
  EVENTO_ATENDIMENTO_REAGENDADO,
} from '../notificacoes/eventos';
import { Disciplina } from '../disciplinas/entities/disciplina.model';
import { Monitoria } from '../monitorias/entities/monitoria.model';
import { MonitoriaParticipante } from '../monitorias/entities/monitoria-participante.model';
import { Avaliacao } from '../avaliacoes/entities/avaliacao.model';
import { MonitoriasService } from '../monitorias/monitorias.service';
import { ContextoParticipacao, ParticipacaoService } from '../monitorias/participacao.service';
import { ParticipantesService } from '../monitorias/participantes.service';
import { Aluno } from '../usuarios/entities/aluno.model';
import { Usuario } from '../usuarios/entities/usuario.model';
import { AgendarAtendimentoDto } from './dto/agendar-atendimento.dto';
import { AtualizarAtendimentoDto } from './dto/atualizar-atendimento.dto';
import { AgendarAtendimentosEmLoteDto } from './dto/agendar-em-lote.dto';
import { FiltroHorariosLivresDto } from './dto/filtro-horarios-livres.dto';
import { LoteDeAtendimentosRespostaDto, ResultadoDeOcorrenciaDto } from './dto/lote-resposta.dto';
import { HorariosLivresRespostaDto } from './dto/horario-livre.dto';
import { AtendimentoRespostaDto, HistoricoStatusRespostaDto } from './dto/atendimento-resposta.dto';
import { CampoOrdenacaoAtendimento, FiltroAtendimentosDto } from './dto/filtro-atendimentos.dto';
import { ReagendarAtendimentoDto } from './dto/reagendar-atendimento.dto';
import { RealizarAtendimentoDto } from './dto/realizar-atendimento.dto';
import { Atendimento } from './entities/atendimento.model';
import { AtendimentoParticipante } from './entities/atendimento-participante.model';
import { AtendimentoStatusHistorico } from './entities/atendimento-status-historico.model';

/**
 * Traducao do campo publico para a coluna real.
 *
 * O cliente nunca escolhe o nome da coluna: ele escolhe uma chave deste mapa.
 * Qualquer valor fora do enum ja foi rejeitado pelo ValidationPipe antes daqui.
 */
/**
 * Campos de agendamento que o avulso e o lote compartilham.
 *
 * `resolverAgendador` e `criarUmAtendimento` so precisam destes; tipa-los assim
 * evita que o lote tenha de fabricar um `AgendarAtendimentoDto` com inicio e
 * fim falsos so para satisfazer a assinatura.
 */
type DadosComunsDeAgendamento = Pick<
  AgendarAtendimentoDto,
  'monitorParticipanteId' | 'assunto' | 'modalidade' | 'local' | 'vagas'
>;

/** A1 — tetos da consulta de horarios livres. */
const MAX_JANELA_DIAS = 60;
const MAX_SLOTS = 500;

/** Sentinela para manter a consulta com uma forma so quando nao ha vinculo. */
const SEM_VINCULO = '00000000-0000-0000-0000-000000000000';

const COLUNA_DE_ORDENACAO: Record<CampoOrdenacaoAtendimento, string> = {
  [CampoOrdenacaoAtendimento.INICIO]: 'inicio',
  [CampoOrdenacaoAtendimento.CRIADO_EM]: 'created_at',
};

interface ContextoDeAvaliacao {
  statusAtendimento: StatusAtendimento;
  minhaInscricaoId: string;
  jaAvaliei: boolean;
}

const INCLUDE_MONITORIA = {
  model: Monitoria,
  as: 'monitoria',
  attributes: ['id', 'ano', 'semestre'],
  include: [{ model: Disciplina, attributes: ['id', 'codigo', 'nome'] }],
};

const INCLUDE_MONITOR = {
  model: MonitoriaParticipante,
  as: 'monitor',
  include: [{ model: Aluno, include: [{ model: Usuario, attributes: ['id', 'nome'] }] }],
};

const INCLUDE_INSCRICOES = {
  model: AtendimentoParticipante,
  as: 'inscricoes',
  include: [
    {
      model: MonitoriaParticipante,
      include: [{ model: Aluno, include: [{ model: Usuario, attributes: ['id', 'nome'] }] }],
    },
  ],
};

@Injectable()
export class AtendimentosService {
  constructor(
    @InjectModel(Atendimento) private readonly atendimentoModel: typeof Atendimento,
    @InjectModel(AtendimentoParticipante)
    private readonly inscricaoModel: typeof AtendimentoParticipante,
    @InjectModel(AtendimentoStatusHistorico)
    private readonly historicoModel: typeof AtendimentoStatusHistorico,
    /**
     * Somente LEITURA, para marcar `jaAvaliei` na inscricao do requisitante.
     * Import de model, nao de modulo: AvaliacoesModule continua sem saber deste.
     */
    @InjectModel(Avaliacao) private readonly avaliacaoModel: typeof Avaliacao,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly participacaoService: ParticipacaoService,
    private readonly participantesService: ParticipantesService,
    private readonly monitoriasService: MonitoriasService,
    private readonly disponibilidadesService: DisponibilidadesService,
    private readonly eventos: EventEmitter2,
    /**
     * D-15 resolvido: os limites de agendamento passaram de constantes deste
     * arquivo para configuracao por instituicao. Ver `agenda.*` em
     * src/config/configuration.ts.
     */
    private readonly config: ConfigService,
  ) {}

  /**
   * Operacao de dominio "agendar atendimento".
   *
   * Concentra todas as regras que o enunciado exige, em camadas:
   *  1. monitoria precisa estar ATIVA;
   *  2. quem agenda define a origem — MONITOR abre a sessao, MONITORADO solicita;
   *  3. o monitor alvo precisa ser MONITOR ATIVO daquela monitoria (RN01/RN02/RN04);
   *  4. o horario precisa caber na disponibilidade declarada do monitor;
   *  5. conflitos de agenda (RN03) sao barrados pelas constraints EXCLUDE — nao
   *     por SELECT previo, que nao sobreviveria a concorrencia.
   */
  async agendar(
    contexto: ContextoParticipacao,
    dto: AgendarAtendimentoDto,
    usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    const atendimentoId = await this.criarUmAtendimento(
      contexto,
      dto,
      usuario,
      dto.inicio,
      dto.fim,
    );

    /**
     * Emitido DEPOIS do commit: um ouvinte que consultasse o atendimento dentro
     * da transacao nao o encontraria. Quem escuta nao e conhecido aqui.
     */
    this.eventos.emit(
      EVENTO_ATENDIMENTO_AGENDADO,
      new AtendimentoAgendadoEvento(
        atendimentoId,
        contexto.monitoria.id,
        await this.origemDe(contexto, dto),
        usuario.id,
      ),
    );

    return this.carregarResposta(atendimentoId);
  }

  /**
   * A2 — serie de sessoes recorrentes em uma requisicao.
   *
   * Abrir 15 sessoes semanais uma a uma e trabalho repetido que ninguem conclui,
   * e o resultado pratico e monitoria com dois horarios cadastrados em vez de
   * quinze.
   *
   * SUCESSO PARCIAL, NAO TUDO-OU-NADA. Cada ocorrencia roda na propria
   * transacao: um feriado ou um choque pontual no meio da serie nao pode
   * derrubar as outras catorze — seria exatamente o problema que motiva este
   * endpoint existir. Por isso a resposta e 200 com o resultado de cada uma, e
   * nao 201.
   */
  async agendarEmLote(
    contexto: ContextoParticipacao,
    dto: AgendarAtendimentosEmLoteDto,
    usuario: UsuarioAutenticado,
  ): Promise<LoteDeAtendimentosRespostaDto> {
    const resultados: ResultadoDeOcorrenciaDto[] = [];
    let primeiroCriadoId: string | null = null;

    for (const ocorrencia of dto.ocorrencias) {
      try {
        const id = await this.criarUmAtendimento(
          contexto,
          dto,
          usuario,
          ocorrencia.inicio,
          ocorrencia.fim,
        );

        primeiroCriadoId ??= id;
        resultados.push({ ...ocorrencia, criado: true, atendimentoId: id });
      } catch (erro) {
        /**
         * A falha de uma ocorrencia vira dado na resposta, nao excecao.
         *
         * Apenas erros de REGRA sao absorvidos, e eles vem por DOIS caminhos:
         * validacao no service (HttpException) e violacao de constraint no
         * banco. O segundo e o mais comum numa serie recorrente — o conflito da
         * RN03 e detectado pelo EXCLUDE, nao por SELECT previo —, e tratar so o
         * primeiro faria um unico choque de horario derrubar as outras catorze.
         *
         * Qualquer outra coisa sobe: engolir falha de infraestrutura
         * transformaria indisponibilidade do banco em "13 de 15 criados".
         */
        const mensagem = this.mensagemDeFalha(erro);

        if (mensagem === null) {
          throw erro;
        }

        resultados.push({ ...ocorrencia, criado: false, erro: mensagem });
      }
    }

    /**
     * UM evento para a serie inteira, referente a primeira ocorrencia.
     *
     * Um evento por ocorrencia significaria, num lote de 16 sessoes com 20
     * monitorados, 320 e-mails de uma vez: queima a cota do provedor, e quem
     * marcar como spam derruba a entrega do lembrete do dia — que e o aviso que
     * de fato importa. A mensagem menciona as demais sessoes em uma linha.
     */
    const criados = resultados.filter((r) => r.criado).length;

    if (primeiroCriadoId) {
      this.eventos.emit(
        EVENTO_ATENDIMENTO_AGENDADO,
        new AtendimentoAgendadoEvento(
          primeiroCriadoId,
          contexto.monitoria.id,
          await this.origemDe(contexto, dto),
          usuario.id,
          criados - 1,
        ),
      );
    }

    return { criados, recusados: resultados.length - criados, resultados };
  }

  /**
   * Mensagem de dominio da recusa, ou `null` se o erro nao for de regra.
   *
   * `null` e o sinal para relancar: so falha de REGRA vira linha recusada no
   * lote.
   */
  private mensagemDeFalha(erro: unknown): string | null {
    const deConstraint = mensagemDeConstraint(erro);

    if (deConstraint) {
      return deConstraint;
    }

    if (!(erro instanceof HttpException)) {
      return null;
    }

    const corpo = erro.getResponse();

    if (typeof corpo === 'string') {
      return corpo;
    }

    const mensagem = (corpo as { message?: string | string[] }).message;

    return Array.isArray(mensagem) ? mensagem.join('; ') : (mensagem ?? erro.message);
  }

  private async origemDe(
    contexto: ContextoParticipacao,
    dto: DadosComunsDeAgendamento,
  ): Promise<OrigemAtendimento> {
    const { origem } = await this.resolverAgendador(contexto, dto);
    return origem;
  }

  /**
   * Nucleo do agendamento, sem emissao de evento.
   *
   * Extraido para que o lote reaproveite exatamente as mesmas regras — duplicar
   * isso criaria dois caminhos que divergem na primeira mudanca de validacao.
   * O evento fica fora porque o lote emite UM para a serie inteira.
   */
  private async criarUmAtendimento(
    contexto: ContextoParticipacao,
    dto: DadosComunsDeAgendamento,
    usuario: UsuarioAutenticado,
    inicioTexto: string,
    fimTexto: string,
  ): Promise<string> {
    const monitoria = contexto.monitoria;
    this.monitoriasService.exigirMonitoriaAtiva(monitoria);

    const inicio = new Date(inicioTexto);
    const fim = new Date(fimTexto);
    this.validarIntervalo(inicio, fim);

    const { monitorParticipante, origem, inscreverSolicitante } = await this.resolverAgendador(
      contexto,
      dto,
    );

    // "Agendamento fora das regras de disponibilidade" e barrado aqui.
    await this.disponibilidadesService.validarJanela(monitorParticipante.id, inicio, fim);

    const vagas = dto.vagas ?? 1;

    if (inscreverSolicitante && vagas < 1) {
      throw new BadRequestException('vagas deve ser no minimo 1.');
    }

    return this.sequelize.transaction(async (transaction) => {
      const atendimento = await this.atendimentoModel.create(
        {
          monitoriaId: monitoria.id,
          monitorParticipanteId: monitorParticipante.id,
          inicio,
          fim,
          vagas,
          modalidade: dto.modalidade,
          local: dto.local ?? null,
          assunto: dto.assunto,
          status: StatusAtendimento.AGENDADO,
          origem,
          criadoPorUsuarioId: usuario.id,
        },
        { transaction },
      );

      if (inscreverSolicitante) {
        await this.inscricaoModel.create(
          {
            atendimentoId: atendimento.id,
            monitoriaId: monitoria.id,
            inicio,
            fim,
            participanteId: contexto.participacao!.id,
            status: StatusInscricao.INSCRITO,
            inscritoEm: new Date(),
            inscritoPorUsuarioId: usuario.id,
          },
          { transaction },
        );
      }

      await this.registrarHistorico(
        atendimento.id,
        null,
        StatusAtendimento.AGENDADO,
        origem === OrigemAtendimento.SOLICITACAO_ALUNO
          ? 'Solicitado pelo aluno monitorado.'
          : 'Sessao aberta pelo monitor.',
        usuario.id,
        transaction,
      );

      return atendimento.id;
    });
  }

  /**
   * Define quem atende e qual a origem, a partir do papel de quem pediu.
   *
   * O monitor nunca pode agendar "em nome de" outro monitor: se ele e o
   * solicitante, o monitor da sessao e ele proprio, ignorando o que veio no
   * corpo. Isso evita que um monitor ocupe a agenda de um colega.
   */
  private async resolverAgendador(
    contexto: ContextoParticipacao,
    dto: DadosComunsDeAgendamento,
  ): Promise<{
    monitorParticipante: MonitoriaParticipante;
    origem: OrigemAtendimento;
    inscreverSolicitante: boolean;
  }> {
    if (contexto.papel === PapelMonitoria.MONITOR) {
      return {
        monitorParticipante: contexto.participacao!,
        origem: OrigemAtendimento.OFERTA_MONITOR,
        inscreverSolicitante: false,
      };
    }

    if (contexto.papel === PapelMonitoria.MONITORADO) {
      if (!dto.monitorParticipanteId) {
        throw new BadRequestException(
          'monitorParticipanteId e obrigatorio: informe qual monitor devera atender.',
        );
      }

      const monitorParticipante = await this.participantesService.exigirMonitorAtivo(
        contexto.monitoria.id,
        dto.monitorParticipanteId,
      );

      return {
        monitorParticipante,
        origem: OrigemAtendimento.SOLICITACAO_ALUNO,
        // A solicitacao ja cria a inscricao de quem pediu: quem solicita um
        // atendimento esta, por definicao, participando dele.
        inscreverSolicitante: true,
      };
    }

    /**
     * Sobra o professor responsavel. Ele administra a monitoria, mas nao atende
     * nem e atendido — nao ha vinculo dele que pudesse ocupar a agenda.
     */
    throw new ForbiddenException(
      'Somente MONITOR ou MONITORADO desta monitoria podem agendar atendimentos.',
    );
  }

  /**
   * Inscricao em sessao coletiva ja existente.
   *
   * A capacidade e verificada com a linha do atendimento travada
   * (SELECT ... FOR UPDATE): duas inscricoes simultanas na ultima vaga passariam
   * pelo mesmo COUNT, e capacidade nao e expressavel como constraint declarativa.
   */
  async inscrever(
    atendimentoId: string,
    usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    const atendimento = await this.buscarOuFalhar(atendimentoId);

    const participante = await this.participacaoService.exigirPapel(
      atendimento.monitoriaId,
      usuario,
      PapelMonitoria.MONITORADO,
    );

    await this.sequelize.transaction(async (transaction) => {
      const travado = await this.atendimentoModel.findByPk(atendimentoId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      this.exigirStatus(travado!, StatusAtendimento.AGENDADO);

      if (travado!.inicio.getTime() <= Date.now()) {
        throw new ConflictException('Nao e possivel se inscrever em um atendimento ja iniciado.');
      }

      const ocupadas = await this.inscricaoModel.count({
        where: {
          atendimentoId,
          status: { [Op.in]: [StatusInscricao.INSCRITO, StatusInscricao.PRESENTE] },
        },
        transaction,
      });

      if (ocupadas >= travado!.vagas) {
        throw new ConflictException('Nao ha vagas disponiveis neste atendimento.');
      }

      const anterior = await this.inscricaoModel.findOne({
        where: { atendimentoId, participanteId: participante.id },
        transaction,
      });

      // Reinscricao apos desistencia reaproveita a linha: a constraint UNIQUE
      // (atendimento, participante) proibe duplicar, e o historico da desistencia
      // ja esta preservado na propria transicao de status.
      if (anterior) {
        if (anterior.status !== StatusInscricao.CANCELADA) {
          throw new ConflictException('Voce ja esta inscrito neste atendimento.');
        }

        await anterior.update(
          { status: StatusInscricao.INSCRITO, inscritoEm: new Date() },
          { transaction },
        );
        return;
      }

      await this.inscricaoModel.create(
        {
          atendimentoId,
          monitoriaId: travado!.monitoriaId,
          inicio: travado!.inicio,
          fim: travado!.fim,
          participanteId: participante.id,
          status: StatusInscricao.INSCRITO,
          inscritoEm: new Date(),
          inscritoPorUsuarioId: usuario.id,
        },
        { transaction },
      );
    });

    return this.carregarResposta(atendimentoId);
  }

  /**
   * Desistencia do aluno.
   *
   * Se a sessao foi criada a pedido dele e ninguem mais restou inscrito, o
   * atendimento inteiro e cancelado: manter uma sessao AGENDADA sem nenhum
   * atendido ocuparia a agenda do monitor sem motivo.
   */
  async cancelarInscricao(
    atendimentoId: string,
    usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    const atendimento = await this.buscarOuFalhar(atendimentoId);

    const participante = await this.participacaoService.exigirPapel(
      atendimento.monitoriaId,
      usuario,
      PapelMonitoria.MONITORADO,
    );

    await this.sequelize.transaction(async (transaction) => {
      const travado = await this.atendimentoModel.findByPk(atendimentoId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      this.exigirStatus(travado!, StatusAtendimento.AGENDADO);

      const inscricao = await this.inscricaoModel.findOne({
        where: { atendimentoId, participanteId: participante.id },
        transaction,
      });

      if (!inscricao || inscricao.status !== StatusInscricao.INSCRITO) {
        throw new ConflictException('Voce nao possui inscricao ativa neste atendimento.');
      }

      /**
       * Janela de cancelamento (D-15). Zero por padrao — o aluno pode desistir
       * ate o instante do inicio, que era o comportamento anterior. Configurado
       * acima de zero, protege o monitor de desistencias de ultima hora.
       */
      const janela = this.config.get<number>('agenda.cancelamentoAntecedenciaMinutos') ?? 0;

      if (janela > 0) {
        const minutosAteOInicio = (travado!.inicio.getTime() - Date.now()) / 60000;

        if (minutosAteOInicio < janela) {
          throw new ConflictException(
            `O cancelamento da inscricao deve ser feito com pelo menos ${janela} minutos ` +
              'de antecedencia. Procure o monitor.',
          );
        }
      }

      await inscricao.update({ status: StatusInscricao.CANCELADA }, { transaction });

      const restantes = await this.inscricaoModel.count({
        where: { atendimentoId, status: StatusInscricao.INSCRITO },
        transaction,
      });

      if (restantes === 0 && travado!.origem === OrigemAtendimento.SOLICITACAO_ALUNO) {
        const motivo = 'Cancelado automaticamente: o aluno solicitante desistiu.';

        await travado!.update(
          { status: StatusAtendimento.CANCELADO, motivoCancelamento: motivo },
          { transaction },
        );

        await this.registrarHistorico(
          atendimentoId,
          StatusAtendimento.AGENDADO,
          StatusAtendimento.CANCELADO,
          motivo,
          usuario.id,
          transaction,
        );
      }
    });

    return this.carregarResposta(atendimentoId);
  }

  /**
   * AGENDADO -> REALIZADO, registrando a presenca de cada inscrito.
   *
   * Quem confirma e o monitor da sessao ou o professor responsavel. O aluno nao
   * pode declarar que foi atendido.
   */
  async realizar(
    atendimentoId: string,
    dto: RealizarAtendimentoDto,
    usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    const atendimento = await this.buscarOuFalhar(atendimentoId);
    await this.exigirMonitorOuProfessor(atendimento, usuario);

    let presentes: string[] = [];

    await this.sequelize.transaction(async (transaction) => {
      const travado = await this.atendimentoModel.findByPk(atendimentoId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      this.exigirStatus(travado!, StatusAtendimento.AGENDADO);

      if (travado!.inicio.getTime() > Date.now()) {
        throw new ConflictException('Nao e possivel marcar como realizado um atendimento futuro.');
      }

      const ausentes = dto.ausentes ?? [];

      const inscricoes = await this.inscricaoModel.findAll({
        where: { atendimentoId, status: StatusInscricao.INSCRITO },
        transaction,
      });

      const idsValidos = new Set(inscricoes.map((i) => i.id));
      const invalido = ausentes.find((id) => !idsValidos.has(id));

      if (invalido) {
        throw new BadRequestException(
          `A inscricao ${invalido} nao pertence a este atendimento ou nao esta ativa.`,
        );
      }

      for (const inscricao of inscricoes) {
        await inscricao.update(
          {
            status: ausentes.includes(inscricao.id)
              ? StatusInscricao.AUSENTE
              : StatusInscricao.PRESENTE,
          },
          { transaction },
        );
      }

      presentes = inscricoes
        .filter((inscricao) => !ausentes.includes(inscricao.id))
        .map((inscricao) => inscricao.participanteId);

      await travado!.update({ status: StatusAtendimento.REALIZADO }, { transaction });

      await this.registrarHistorico(
        atendimentoId,
        StatusAtendimento.AGENDADO,
        StatusAtendimento.REALIZADO,
        ausentes.length > 0 ? `${ausentes.length} ausencia(s) registrada(s).` : null,
        usuario.id,
        transaction,
      );
    });

    /**
     * Emitido DEPOIS do commit, de proposito.
     *
     * Um ouvinte que rodasse dentro da transacao leria dados ainda nao
     * confirmados e, se falhasse, derrubaria a realizacao do atendimento junto.
     * Gamificacao e consequencia, nao pre-condicao.
     */
    this.eventos.emit(
      EVENTO_ATENDIMENTO_REALIZADO,
      new AtendimentoRealizadoEvento(
        atendimentoId,
        atendimento.monitoriaId,
        atendimento.monitorParticipanteId,
        presentes,
      ),
    );

    return this.carregarResposta(atendimentoId);
  }

  /**
   * AGENDADO -> CANCELADO.
   *
   * O registro NUNCA e removido do banco: o atendimento continua consultavel,
   * com motivo, autor e data da transicao no historico (RN10). E por isso que
   * nao existe DELETE nesta API.
   */
  async cancelar(
    atendimentoId: string,
    motivo: string,
    usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    const atendimento = await this.buscarOuFalhar(atendimentoId);
    await this.exigirMonitorOuProfessor(atendimento, usuario);

    let inscritosUsuarioIds: string[] = [];

    const historicoId = await this.sequelize.transaction(async (transaction) => {
      const travado = await this.atendimentoModel.findByPk(atendimentoId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      this.exigirStatus(travado!, StatusAtendimento.AGENDADO);

      /**
       * Colhido ANTES do update abaixo, e a ordem e o ponto inteiro.
       *
       * O proximo comando cancela as inscricoes, e com isso apaga o unico
       * registro de quem estava inscrito. Quem for avisar precisa desta lista,
       * e depois daqui ela nao existe mais em lugar nenhum.
       */
      inscritosUsuarioIds = await this.alunosInscritos(atendimentoId, transaction);

      await travado!.update(
        { status: StatusAtendimento.CANCELADO, motivoCancelamento: motivo },
        { transaction },
      );

      // As inscricoes acompanham o cancelamento para liberar a agenda dos alunos:
      // a constraint EXCLUDE so ignora inscricoes fora de INSCRITO/PRESENTE.
      await this.inscricaoModel.update(
        { status: StatusInscricao.CANCELADA },
        { where: { atendimentoId, status: StatusInscricao.INSCRITO }, transaction },
      );

      return this.registrarHistorico(
        atendimentoId,
        StatusAtendimento.AGENDADO,
        StatusAtendimento.CANCELADO,
        motivo,
        usuario.id,
        transaction,
      );
    });

    this.eventos.emit(
      EVENTO_ATENDIMENTO_CANCELADO,
      new AtendimentoCanceladoEvento(
        atendimentoId,
        historicoId,
        motivo,
        usuario.id,
        inscritosUsuarioIds,
      ),
    );

    return this.carregarResposta(atendimentoId);
  }

  /**
   * A1 — slots concretos e clicaveis, para o cliente nao precisar adivinhar.
   *
   * O calculo NAO cabe no frontend, e nao por comodidade: a expansao das faixas
   * semanais depende de `AT TIME ZONE` com o fuso da instituicao, o conflito do
   * solicitante envolve inscricoes dele em monitorias que ele talvez nao possa
   * ler, e a antecedencia minima se mede contra o relogio do servidor. Qualquer
   * uma das tres calculada no cliente produziria sugestao que o POST recusaria.
   *
   * E SUGESTAO, NAO RESERVA. A resposta e uma fotografia do instante da
   * consulta: dois usuarios podem receber o mesmo slot, e quem agendar primeiro
   * fica com ele. A verificacao autoritativa continua no POST, contra as
   * constraints.
   *
   * Tudo em uma consulta so, em SQL, pela mesma razao de `validarJanela`:
   * expandir faixas semanais em JavaScript traria o fuso do processo Node para
   * dentro da regra.
   */
  async horariosLivres(
    monitoriaId: string,
    filtro: FiltroHorariosLivresDto,
    usuario: UsuarioAutenticado,
  ): Promise<HorariosLivresRespostaDto> {
    const de = new Date(filtro.de);
    const ate = new Date(filtro.ate);

    if (ate <= de) {
      throw new BadRequestException('ate deve ser posterior a de.');
    }

    if (ate.getTime() - de.getTime() > MAX_JANELA_DIAS * 24 * 3600_000) {
      throw new BadRequestException(
        `A janela entre de e ate nao pode passar de ${MAX_JANELA_DIAS} dias.`,
      );
    }

    const duracao =
      filtro.duracaoMinutos ?? this.config.get<number>('agenda.duracaoPadraoMinutos') ?? 60;
    const minima = this.config.get<number>('agenda.duracaoMinimaMinutos') ?? 15;
    const maxima = this.config.get<number>('agenda.duracaoMaximaMinutos') ?? 240;

    if (duracao < minima || duracao > maxima) {
      throw new BadRequestException(
        `duracaoMinutos deve estar entre ${minima} e ${maxima} (ver GET /configuracao).`,
      );
    }

    /**
     * Vinculos do SOLICITANTE, para subtrair a agenda dele.
     *
     * Professor sem perfil de aluno nao tem vinculo nenhum — o sentinela evita
     * um `IN ()` vazio e mantem a consulta com uma unica forma.
     */
    const vinculos = await this.participacaoService.listarVinculosDoAluno(usuario.id);
    const idsDoSolicitante = vinculos.length > 0 ? vinculos.map((v) => v.id) : [SEM_VINCULO];

    const linhas = (await this.sequelize.query(
      `
      WITH dias AS (
        SELECT d::date AS dia
          FROM generate_series(
                 (:de::timestamptz  AT TIME ZONE :fuso)::date,
                 (:ate::timestamptz AT TIME ZONE :fuso)::date,
                 interval '1 day') AS d
      ),
      faixas AS (
        SELECT disp.participante_id, u.nome AS nome_monitor,
               disp.dia_semana, disp.hora_inicio, disp.hora_fim
          FROM disponibilidades disp
          JOIN monitoria_participantes mp ON mp.id = disp.participante_id
          JOIN usuarios u ON u.id = mp.aluno_id
         WHERE disp.ativa
           AND mp.monitoria_id = :monitoriaId
           AND mp.papel = 'MONITOR'
           AND mp.status = 'ATIVO'
           AND (:monitorParticipanteId::uuid IS NULL OR mp.id = :monitorParticipanteId::uuid)
      ),
      slots AS (
        SELECT f.participante_id, f.nome_monitor,
               (s AT TIME ZONE :fuso)                                   AS inicio,
               ((s + make_interval(mins => :duracao)) AT TIME ZONE :fuso) AS fim
          FROM faixas f
          JOIN dias ON EXTRACT(DOW FROM dias.dia) = f.dia_semana
          CROSS JOIN LATERAL generate_series(
                 dias.dia + f.hora_inicio,
                 dias.dia + f.hora_fim - make_interval(mins => :duracao),
                 make_interval(mins => :duracao)) AS s
      )
      SELECT slots.inicio, slots.fim,
             slots.participante_id AS "monitorParticipanteId",
             slots.nome_monitor    AS "nomeMonitor"
        FROM slots
       WHERE slots.inicio >= GREATEST(:de::timestamptz,
                                      now() + make_interval(mins => :antecedencia))
         AND slots.fim   <= :ate::timestamptz
         AND NOT EXISTS (
               SELECT 1 FROM atendimentos a
                WHERE a.monitor_participante_id = slots.participante_id
                  AND a.status = 'AGENDADO'
                  AND tstzrange(a.inicio, a.fim) && tstzrange(slots.inicio, slots.fim))
         AND NOT EXISTS (
               SELECT 1 FROM atendimento_participantes ap
                WHERE ap.participante_id IN (:idsDoSolicitante)
                  AND ap.status IN ('INSCRITO', 'PRESENTE')
                  AND tstzrange(ap.inicio, ap.fim) && tstzrange(slots.inicio, slots.fim))
       ORDER BY slots.inicio, slots.nome_monitor
       LIMIT :limite
      `,
      {
        replacements: {
          monitoriaId,
          fuso: this.config.getOrThrow<string>('agenda.fusoHorario'),
          de: de.toISOString(),
          ate: ate.toISOString(),
          duracao,
          antecedencia: this.config.get<number>('agenda.antecedenciaMinimaMinutos') ?? 0,
          monitorParticipanteId: filtro.monitorParticipanteId ?? null,
          idsDoSolicitante,
          limite: MAX_SLOTS + 1,
        },
        type: QueryTypes.SELECT,
      },
    )) as { inicio: Date; fim: Date; monitorParticipanteId: string; nomeMonitor: string }[];

    const truncado = linhas.length > MAX_SLOTS;

    return {
      horarios: linhas.slice(0, MAX_SLOTS).map((linha) => ({
        inicio: linha.inicio.toISOString(),
        fim: linha.fim.toISOString(),
        monitorParticipanteId: linha.monitorParticipanteId,
        nomeMonitor: linha.nomeMonitor,
      })),
      truncado,
    };
  }

  /**
   * Edicao dos dados basicos de uma sessao ja agendada.
   *
   * Deliberadamente SEM horario: `inicio` e `fim` mudam apenas por `reagendar`,
   * que valida a disponibilidade do monitor, recusa conflito na agenda dos
   * inscritos (RN03), registra a transicao (RN10) e avisa quem estava inscrito.
   * Permitir horario aqui seria oferecer um atalho que contorna as quatro coisas.
   *
   * Nao gera linha de historico porque nao ha transicao de status: o
   * `atendimento_status_historico` registra mudanca de ESTADO, e assunto, local
   * e vagas nao sao estado. A trilha desta edicao fica em `logs_requisicao`,
   * que guarda corpo e autor da requisicao.
   */
  async atualizar(
    atendimentoId: string,
    dto: AtualizarAtendimentoDto,
    usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    const atendimento = await this.buscarOuFalhar(atendimentoId);
    await this.exigirMonitorOuProfessor(atendimento, usuario);

    /**
     * So AGENDADO aceita edicao.
     *
     * Atendimento realizado e um fato consumado: mudar o assunto depois
     * reescreveria o que aconteceu, e a avaliacao de quem participou passaria a
     * se referir a outra coisa. Cancelado, pela mesma razao, fica como ficou.
     */
    this.exigirStatus(atendimento, StatusAtendimento.AGENDADO);

    if (dto.vagas !== undefined) {
      await this.exigirVagasSuficientes(atendimentoId, dto.vagas);
    }

    await atendimento.update({
      ...(dto.assunto !== undefined ? { assunto: dto.assunto } : {}),
      ...(dto.vagas !== undefined ? { vagas: dto.vagas } : {}),
      // String vazia e o unico jeito de LIMPAR o local: omitir significa
      // "nao mexer", e o DTO nao aceita null.
      ...(dto.local !== undefined ? { local: dto.local === '' ? null : dto.local } : {}),
    });

    return this.carregarResposta(atendimentoId, false, usuario);
  }

  /**
   * Reduzir vagas abaixo de quem ja esta dentro deixaria a sessao em estado que
   * nenhuma outra operacao consegue produzir — mais inscritos que capacidade.
   * A inscricao e barrada por `ocupadas >= vagas`; sem esta verificacao, a
   * edicao seria a porta dos fundos dessa regra.
   */
  private async exigirVagasSuficientes(atendimentoId: string, vagas: number): Promise<void> {
    const ocupadas = await this.inscricaoModel.count({
      where: {
        atendimentoId,
        status: { [Op.in]: [StatusInscricao.INSCRITO, StatusInscricao.PRESENTE] },
      },
    });

    if (vagas < ocupadas) {
      throw new ConflictException(
        `Ja ha ${ocupadas} inscrito(s) neste atendimento: vagas nao pode ser menor que isso. ` +
          'Cancele inscricoes antes de reduzir a capacidade.',
      );
    }
  }

  /**
   * Reagenda um atendimento AGENDADO, preservando as inscricoes.
   *
   * Usa a infraestrutura que ja existia e nao era exercitada: a FK composta
   * (atendimento_id, monitoria_id, inicio, fim) com ON UPDATE CASCADE propaga o
   * novo horario para todas as inscricoes sozinha — sem trigger, sem UPDATE
   * manual, e sem janela em que pai e filhos discordem.
   *
   * Conforme a D-22, um inscrito com conflito no novo horario REJEITA o
   * reagendamento inteiro, em vez de ser removido em silencio. O que garante
   * isso e a constraint `ex_aluno_sem_conflito`, que dispara durante o CASCADE;
   * a consulta previa abaixo serve apenas para dizer QUEM conflita, porque a
   * constraint sozinha nao tem como informar isso.
   */
  async reagendar(
    atendimentoId: string,
    dto: ReagendarAtendimentoDto,
    usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    const atendimento = await this.buscarOuFalhar(atendimentoId);
    await this.exigirMonitorOuProfessor(atendimento, usuario);

    const inicio = new Date(dto.inicio);
    const fim = new Date(dto.fim);

    this.exigirStatus(atendimento, StatusAtendimento.AGENDADO);
    this.validarIntervalo(inicio, fim);

    // O novo horario tambem precisa caber na disponibilidade declarada.
    await this.disponibilidadesService.validarJanela(
      atendimento.monitorParticipanteId,
      inicio,
      fim,
    );

    const conflitantes = await this.inscritosComConflito(atendimentoId, inicio, fim);

    if (conflitantes.length > 0) {
      throw new ConflictException(
        `O novo horario conflita com a agenda de: ${conflitantes.join(', ')}. ` +
          'Cancele a inscricao dessas pessoas ou escolha outro horario.',
      );
    }

    const historicoId = await this.sequelize.transaction(async (transaction) => {
      const travado = await this.atendimentoModel.findByPk(atendimentoId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      this.exigirStatus(travado!, StatusAtendimento.AGENDADO);

      const anterior = `${travado!.inicio.toISOString()} - ${travado!.fim.toISOString()}`;

      await travado!.update({ inicio, fim }, { transaction });

      return this.registrarHistorico(
        atendimentoId,
        StatusAtendimento.AGENDADO,
        StatusAtendimento.AGENDADO,
        `Reagendado. Antes: ${anterior}. Agora: ${inicio.toISOString()} - ${fim.toISOString()}. Motivo: ${dto.motivo}`,
        usuario.id,
        transaction,
      );
    });

    this.eventos.emit(
      EVENTO_ATENDIMENTO_REAGENDADO,
      new AtendimentoReagendadoEvento(atendimentoId, historicoId, usuario.id),
    );

    return this.carregarResposta(atendimentoId, false, usuario);
  }

  /**
   * Ids de usuario de quem esta INSCRITO no atendimento, neste instante.
   *
   * Roda dentro da transacao de quem chama porque o valor so e correto antes de
   * o cancelamento mexer nas inscricoes.
   */
  private async alunosInscritos(
    atendimentoId: string,
    transaction: Transaction,
  ): Promise<string[]> {
    const linhas = (await this.sequelize.query(
      `SELECT mp.aluno_id AS "usuarioId"
         FROM atendimento_participantes ap
         JOIN monitoria_participantes mp ON mp.id = ap.participante_id
        WHERE ap.atendimento_id = :atendimentoId
          AND ap.status = 'INSCRITO'`,
      {
        replacements: { atendimentoId },
        type: QueryTypes.SELECT,
        transaction,
      },
    )) as { usuarioId: string }[];

    return linhas.map((linha) => linha.usuarioId);
  }

  /** Nomes dos inscritos cuja agenda colide com a janela proposta. */
  private async inscritosComConflito(
    atendimentoId: string,
    inicio: Date,
    fim: Date,
  ): Promise<string[]> {
    const linhas = (await this.sequelize.query(
      `
      SELECT DISTINCT u.nome
        FROM atendimento_participantes minha
        JOIN monitoria_participantes mp ON mp.id = minha.participante_id
        JOIN usuarios u ON u.id = mp.aluno_id
        JOIN atendimento_participantes outra
          ON outra.participante_id = minha.participante_id
         AND outra.atendimento_id <> minha.atendimento_id
         AND outra.status IN ('INSCRITO', 'PRESENTE')
         AND tstzrange(outra.inicio, outra.fim) && tstzrange(:inicio, :fim)
       WHERE minha.atendimento_id = :atendimentoId
         AND minha.status IN ('INSCRITO', 'PRESENTE')
       ORDER BY u.nome;
      `,
      {
        replacements: {
          atendimentoId,
          inicio: inicio.toISOString(),
          fim: fim.toISOString(),
        },
        type: QueryTypes.SELECT,
      },
    )) as unknown as { nome: string }[];

    return linhas.map((linha) => linha.nome);
  }

  async listarPorMonitoria(
    monitoriaId: string,
    filtro: FiltroAtendimentosDto,
    usuario?: UsuarioAutenticado,
  ): Promise<RespostaPaginada<AtendimentoRespostaDto>> {
    this.recusarFiltrosPessoais(filtro);

    const where = this.montarFiltro(filtro);
    where.monitoriaId = monitoriaId;

    const { rows, count } = await this.atendimentoModel.findAndCountAll({
      where,
      include: [INCLUDE_MONITORIA, INCLUDE_MONITOR, INCLUDE_INSCRICOES],
      order: this.montarOrdenacao(filtro),
      limit: filtro.limite,
      offset: filtro.offset,
      distinct: true,
    });

    const contextos = usuario
      ? await this.montarContextosDeAvaliacao(rows, usuario)
      : new Map<string, ContextoDeAvaliacao>();

    return new RespostaPaginada(
      rows.map((atendimento) =>
        AtendimentoRespostaDto.deModelo(atendimento, contextos.get(atendimento.id)),
      ),
      count,
      filtro.pagina,
      filtro.limite,
    );
  }

  /**
   * Agenda pessoal: tudo em que o usuario esta envolvido, como monitor ou como
   * inscrito, em qualquer monitoria. Inclui CANCELADOS e REALIZADOS — e o
   * historico previsto pela RN10, nao apenas o que esta por vir.
   */
  async meusAtendimentos(
    usuario: UsuarioAutenticado,
    filtro: FiltroAtendimentosDto,
  ): Promise<RespostaPaginada<AtendimentoRespostaDto>> {
    /**
     * Os dois recortam o mesmo conjunto por criterios opostos — um exige
     * AGENDADO, o outro REALIZADO. Combina-los devolveria sempre lista vazia, o
     * que o cliente leria como "nada pendente" em vez de "pedido incoerente".
     */
    if (filtro.aguardandoRegistro && filtro.pendentesDeAvaliacao) {
      throw new BadRequestException(
        'aguardandoRegistro e pendentesDeAvaliacao sao mutuamente exclusivos: ' +
          'um exige AGENDADO e o outro REALIZADO.',
      );
    }

    const participacoes = await this.participacaoService.listarVinculosDoAluno(usuario.id);
    const idsParticipacao = participacoes.map((p) => p.id);

    if (idsParticipacao.length === 0) {
      return new RespostaPaginada([], 0, filtro.pagina, filtro.limite);
    }

    const inscricoes = await this.inscricaoModel.findAll({
      where: { participanteId: { [Op.in]: idsParticipacao } },
      attributes: ['atendimentoId'],
    });

    const where = this.montarFiltro(filtro);

    if (filtro.aguardandoRegistro) {
      /**
       * Fila do monitor: so o que ELE conduz, ja comecado e ainda AGENDADO.
       * Nao entra no OR abaixo porque aqui o recorte e exclusivamente o papel
       * de monitor — inscricoes dele como monitorado nao pertencem a esta fila.
       */
      where.monitorParticipanteId = { [Op.in]: idsParticipacao };
      where.status = StatusAtendimento.AGENDADO;
      where.inicio = { [Op.lt]: new Date() };
    } else if (filtro.pendentesDeAvaliacao) {
      /**
       * Mesmo criterio de `InscricaoRespostaDto.podeAvaliar`: REALIZADO,
       * presenca confirmada e sem avaliacao minha. Expresso em SQL porque as
       * duas ultimas condicoes vivem em tabelas filhas.
       */
      where.status = StatusAtendimento.REALIZADO;
      where[Op.and as unknown as string] = [
        this.sequelize.literal(
          `EXISTS (
             SELECT 1
               FROM atendimento_participantes ap
              WHERE ap.atendimento_id = "Atendimento"."id"
                AND ap.participante_id IN (:vinculosDoAluno)
                AND ap.status = 'PRESENTE'
                AND NOT EXISTS (
                      SELECT 1 FROM avaliacoes av
                       WHERE av.atendimento_participante_id = ap.id))`,
        ),
      ];
    } else {
      where[Op.or as unknown as string] = [
        { monitorParticipanteId: { [Op.in]: idsParticipacao } },
        { id: { [Op.in]: inscricoes.map((i) => i.atendimentoId) } },
      ];
    }

    const { rows, count } = await this.atendimentoModel.findAndCountAll({
      where,
      include: [INCLUDE_MONITORIA, INCLUDE_MONITOR, INCLUDE_INSCRICOES],
      order: this.montarOrdenacao(filtro),
      limit: filtro.limite,
      offset: filtro.offset,
      distinct: true,
      replacements: { vinculosDoAluno: idsParticipacao },
    });

    const contextos = await this.montarContextosDeAvaliacao(rows, usuario);

    return new RespostaPaginada(
      rows.map((atendimento) =>
        AtendimentoRespostaDto.deModelo(atendimento, contextos.get(atendimento.id)),
      ),
      count,
      filtro.pagina,
      filtro.limite,
    );
  }

  /** RN04/RN07: so quem participa da monitoria enxerga o atendimento. */
  async detalhar(
    atendimentoId: string,
    usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    const atendimento = await this.buscarOuFalhar(atendimentoId);
    await this.participacaoService.exigirAcesso(atendimento.monitoriaId, usuario);

    return this.carregarResposta(atendimentoId, true, usuario);
  }

  async historico(
    atendimentoId: string,
    usuario: UsuarioAutenticado,
  ): Promise<HistoricoStatusRespostaDto[]> {
    const atendimento = await this.buscarOuFalhar(atendimentoId);
    await this.participacaoService.exigirAcesso(atendimento.monitoriaId, usuario);

    const registros = await this.historicoModel.findAll({
      where: { atendimentoId },
      include: [{ model: Usuario, as: 'alteradoPor', attributes: ['id', 'nome'] }],
      order: [['criado_em', 'ASC']],
    });

    return registros.map(HistoricoStatusRespostaDto.deModelo);
  }

  /**
   * Descobre, para cada atendimento da lista, a inscricao DO REQUISITANTE e se
   * ele ja a avaliou.
   *
   * Sem isto o cliente nao consegue decidir entre mostrar "Avaliar" e "ja
   * avaliado": a unica forma de descobrir seria tentar e receber 409, ou seja,
   * o usuario clica, espera e leva um erro.
   *
   * Uma consulta so para todos os atendimentos da pagina — nao uma por linha.
   */
  private async montarContextosDeAvaliacao(
    atendimentos: Atendimento[],
    usuario: UsuarioAutenticado,
  ): Promise<Map<string, ContextoDeAvaliacao>> {
    const contextos = new Map<string, ContextoDeAvaliacao>();

    const minhasInscricoes = atendimentos
      .map((atendimento) => ({
        atendimento,
        inscricao: (atendimento.inscricoes ?? []).find(
          (i) => i.participante?.alunoId === usuario.id,
        ),
      }))
      .filter((par) => par.inscricao !== undefined);

    if (minhasInscricoes.length === 0) {
      return contextos;
    }

    const avaliadas = await this.avaliacaoModel.findAll({
      where: {
        atendimentoParticipanteId: {
          [Op.in]: minhasInscricoes.map((par) => par.inscricao!.id),
        },
      },
      attributes: ['atendimentoParticipanteId'],
    });

    const idsAvaliados = new Set(avaliadas.map((a) => a.atendimentoParticipanteId));

    for (const { atendimento, inscricao } of minhasInscricoes) {
      contextos.set(atendimento.id, {
        statusAtendimento: atendimento.status,
        minhaInscricaoId: inscricao!.id,
        jaAvaliei: idsAvaliados.has(inscricao!.id),
      });
    }

    return contextos;
  }

  private montarOrdenacao(filtro: FiltroAtendimentosDto): [string, string][] {
    const coluna = COLUNA_DE_ORDENACAO[filtro.ordenarPor] ?? COLUNA_DE_ORDENACAO.inicio;
    const direcao = filtro.direcao === 'asc' ? 'ASC' : 'DESC';

    return [[coluna, direcao]];
  }

  /**
   * A4 — os dois filtros de agenda pessoal nao fazem sentido fora de /meus.
   *
   * Ignorar em silencio seria pior que recusar: o cliente receberia uma lista
   * plausivel, porem sem o recorte pedido, e o contador da tela sairia errado
   * sem nenhum sinal. Mesmo raciocinio do `forbidNonWhitelisted`.
   */
  private recusarFiltrosPessoais(filtro: FiltroAtendimentosDto): void {
    const pessoais = [
      ['aguardandoRegistro', filtro.aguardandoRegistro],
      ['pendentesDeAvaliacao', filtro.pendentesDeAvaliacao],
    ].filter(([, valor]) => valor !== undefined);

    if (pessoais.length > 0) {
      throw new BadRequestException(
        `${pessoais.map(([nome]) => nome).join(' e ')} e filtro de agenda pessoal: ` +
          'use GET /atendimentos/meus.',
      );
    }
  }

  private montarFiltro(filtro: FiltroAtendimentosDto): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    if (filtro.status) where.status = filtro.status;
    if (filtro.monitorParticipanteId) where.monitorParticipanteId = filtro.monitorParticipanteId;

    if (filtro.aceitandoInscricao) {
      where.status = StatusAtendimento.AGENDADO;
      where.inicio = { [Op.gt]: new Date() };

      /**
       * A contagem de ocupacao nao existe como coluna — e derivada das
       * inscricoes. O literal compara a contagem com `vagas` na propria
       * consulta; nao ha entrada do cliente aqui, apenas nomes de tabela fixos.
       */
      where[Op.and as unknown as string] = [
        this.sequelize.literal(
          `(SELECT COUNT(*) FROM atendimento_participantes ap
              WHERE ap.atendimento_id = "Atendimento"."id"
                AND ap.status IN ('INSCRITO', 'PRESENTE')) < "Atendimento"."vagas"`,
        ),
      ];
    }

    if (filtro.de || filtro.ate) {
      where.inicio = {
        ...(filtro.de ? { [Op.gte]: new Date(filtro.de) } : {}),
        ...(filtro.ate ? { [Op.lte]: new Date(filtro.ate) } : {}),
      };
    }

    return where;
  }

  private async buscarOuFalhar(atendimentoId: string): Promise<Atendimento> {
    const atendimento = await this.atendimentoModel.findByPk(atendimentoId);

    if (!atendimento) {
      throw new NotFoundException('Atendimento nao encontrado.');
    }

    return atendimento;
  }

  private async carregarResposta(
    atendimentoId: string,
    comHistorico = false,
    usuario?: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    const atendimento = await this.atendimentoModel.findByPk(atendimentoId, {
      include: comHistorico
        ? [
            INCLUDE_MONITORIA,
            INCLUDE_MONITOR,
            INCLUDE_INSCRICOES,
            {
              model: AtendimentoStatusHistorico,
              as: 'historico',
              include: [{ model: Usuario, as: 'alteradoPor', attributes: ['id', 'nome'] }],
            },
          ]
        : [INCLUDE_MONITORIA, INCLUDE_MONITOR, INCLUDE_INSCRICOES],
    });

    const contextos = usuario
      ? await this.montarContextosDeAvaliacao([atendimento!], usuario)
      : new Map<string, ContextoDeAvaliacao>();

    return AtendimentoRespostaDto.deModelo(atendimento!, contextos.get(atendimentoId));
  }

  /**
   * Autorizacao das transicoes de estado.
   *
   * Nao ha guard declarativo aqui porque a monitoria nao esta na URL: ela e
   * descoberta a partir do proprio atendimento. A verificacao continua sendo do
   * backend, apenas no ponto onde o contexto existe.
   */
  private async exigirMonitorOuProfessor(
    atendimento: Atendimento,
    usuario: UsuarioAutenticado,
  ): Promise<void> {
    const contexto = await this.participacaoService.obterContexto(atendimento.monitoriaId, usuario);

    if (contexto.ehProfessorResponsavel) {
      return;
    }

    const ehMonitorDaSessao =
      contexto.participacao?.id === atendimento.monitorParticipanteId &&
      contexto.participacao?.status === StatusParticipacao.ATIVO;

    if (!ehMonitorDaSessao) {
      throw new ForbiddenException(
        'Apenas o monitor responsavel pelo atendimento ou o professor da monitoria podem alterar seu status.',
      );
    }
  }

  private exigirStatus(atendimento: Atendimento, esperado: StatusAtendimento): void {
    if (atendimento.status !== esperado) {
      throw new ConflictException(
        `Atendimento com status ${atendimento.status} nao aceita esta operacao. ` +
          `Status esperado: ${esperado}.`,
      );
    }
  }

  private validarIntervalo(inicio: Date, fim: Date): void {
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      throw new BadRequestException('inicio e fim devem ser datas validas.');
    }

    if (fim <= inicio) {
      throw new BadRequestException('fim deve ser posterior a inicio.');
    }

    if (inicio.getTime() <= Date.now()) {
      throw new BadRequestException('Nao e possivel agendar atendimento no passado.');
    }

    const minima = this.config.get<number>('agenda.duracaoMinimaMinutos') ?? 15;
    const maxima = this.config.get<number>('agenda.duracaoMaximaMinutos') ?? 240;
    const antecedencia = this.config.get<number>('agenda.antecedenciaMinimaMinutos') ?? 0;

    const minutos = (fim.getTime() - inicio.getTime()) / 60000;

    if (minutos < minima) {
      throw new BadRequestException(`A duracao minima de um atendimento e de ${minima} minutos.`);
    }

    if (minutos > maxima) {
      throw new BadRequestException(`A duracao maxima de um atendimento e de ${maxima} minutos.`);
    }

    // Antecedencia 0 (default) desliga a regra: qualquer horario futuro serve.
    if (antecedencia > 0) {
      const minutosAteOInicio = (inicio.getTime() - Date.now()) / 60000;

      if (minutosAteOInicio < antecedencia) {
        throw new BadRequestException(
          `O agendamento exige pelo menos ${antecedencia} minutos de antecedencia.`,
        );
      }
    }
  }

  /**
   * Toda transicao de status vira uma linha imutavel. E o historico da RN10.
   *
   * Devolve o ID da linha criada: as notificacoes de transicao o usam como chave
   * de idempotencia. Precisa ser o id do HISTORICO, e nao o do atendimento —
   * reagendar duas vezes gera duas linhas, e so assim o segundo aviso nao e
   * descartado como duplicata do primeiro.
   */
  private async registrarHistorico(
    atendimentoId: string,
    statusAnterior: StatusAtendimento | null,
    statusNovo: StatusAtendimento,
    motivo: string | null,
    usuarioId: string,
    transaction: Transaction,
  ): Promise<string> {
    const linha = await this.historicoModel.create(
      {
        atendimentoId,
        statusAnterior,
        statusNovo,
        motivo,
        alteradoPorUsuarioId: usuarioId,
        criadoEm: new Date(),
      },
      { transaction },
    );

    return linha.id;
  }
}
