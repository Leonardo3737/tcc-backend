import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { OrigemAtendimento } from '../../common/enums/origem-atendimento.enum';
import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { TipoNotificacao } from '../../common/enums/tipo-notificacao.enum';
import { EmailService } from '../email/email.service';
import { AtendimentoRealizadoEvento, EVENTO_ATENDIMENTO_REALIZADO } from '../gamificacao/eventos';
import { Notificacao } from './entities/notificacao.model';
import {
  AtendimentoAgendadoEvento,
  AtendimentoCanceladoEvento,
  AtendimentoReagendadoEvento,
  EVENTO_ATENDIMENTO_AGENDADO,
  EVENTO_ATENDIMENTO_CANCELADO,
  EVENTO_ATENDIMENTO_REAGENDADO,
  EVENTO_MONITOR_HABILITADO,
  MonitorHabilitadoEvento,
} from './eventos';
import { DadosDoAtendimento, MENSAGENS, ReferenciasDeLink, montarLink } from './mensagens';

/** Teto de tentativas por notificacao antes de desistir. */
const MAX_TENTATIVAS = 5;

interface Destinatario {
  usuarioId: string;
  nome: string;
  email: string;
}

/**
 * Um despacho. Objeto, e nao parametros posicionais, porque sao sete campos e
 * tres deles opcionais — a chamada ficaria ilegivel em qualquer outra forma.
 */
interface PedidoDeDespacho {
  tipo: TipoNotificacao;
  /** Chave de idempotencia. NEM SEMPRE e o destino do link. */
  referenciaId: string;
  destinatarios: Destinatario[];
  dados: DadosDoAtendimento;
  /**
   * De onde sai o LINK: em avisos de transicao a `referenciaId` e a linha de
   * historico, que nao corresponde a pagina nenhuma.
   */
  referenciasDeLink: ReferenciasDeLink;
  motivo?: string;
  /** Papel de quem recebe. Hoje so o lembrete do dia muda o texto por ele. */
  papel?: PapelMonitoria;
  inscritos?: number;
  /** Inscricoes canceladas pela promocao a monitor (A3). */
  inscricoesCanceladas?: number;
  /** Outras sessoes criadas no mesmo lote (A2). */
  demaisSessoes?: number;
}

interface ContextoDeAtendimento extends DadosDoAtendimento {
  atendimentoId: string;
  monitoriaId: string;
  monitorUsuarioId: string;
}

/**
 * Avisos por e-mail.
 *
 * Modulo FOLHA: ninguem o importa. Ele escuta eventos do nucleo e roda rotinas
 * proprias. Remove-lo do AppModule desliga os avisos sem quebrar compilacao nem
 * regra de negocio — exatamente como a gamificacao.
 *
 * DOIS GATILHOS, por natureza diferente:
 *   - EVENTO, para fatos: cancelamento, reagendamento, habilitacao de monitor;
 *   - ROTINA, para a passagem do tempo: o lembrete do dia.
 *
 * TODO AVISO PASSA POR `despachar`, que segue sempre a mesma ordem:
 * reservar a linha no banco -> enviar -> marcar como enviada. Reservar ANTES de
 * enviar e o que torna o envio unico mesmo com duas instancias rodando: a
 * segunda perde para a UNIQUE e nem chega a montar a mensagem.
 *
 * Nada aqui lanca para fora. Uma falha de aviso nao pode derrubar o
 * cancelamento de um atendimento que ja aconteceu — e a mesma politica da
 * gamificacao e do EmailService.
 */
@Injectable()
export class NotificacoesService implements OnModuleInit {
  private readonly logger = new Logger(NotificacoesService.name);

  constructor(
    @InjectModel(Notificacao) private readonly notificacaoModel: typeof Notificacao,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.habilitadas()) {
      this.logger.warn(
        'Notificacoes DESABILITADAS (NOTIFICACOES_HABILITADAS != true). Nenhum aviso ' +
          'sera gerado nem enviado.',
      );
      return;
    }

    this.logger.log(`Notificacoes habilitadas. Fuso de referencia: ${this.fuso()}.`);
  }

  // ------------------------------------------------------------------ EVENTOS

  /**
   * Atendimento aberto ou solicitado.
   *
   * A origem decide quem e avisado, e nao ha caso em que os dois lados precisem
   * saber: quem agendou ja sabe. O monitor e avisado quando o ALUNO solicitou;
   * os monitorados sao avisados quando o MONITOR abriu sessao.
   */
  @OnEvent(EVENTO_ATENDIMENTO_AGENDADO)
  async aoAgendar(evento: AtendimentoAgendadoEvento): Promise<void> {
    await this.protegido('agendamento', async () => {
      const contexto = await this.contextoDoAtendimento(evento.atendimentoId);

      if (!contexto) {
        return;
      }

      if (evento.origem === OrigemAtendimento.SOLICITACAO_ALUNO) {
        const monitor = await this.usuarios([contexto.monitorUsuarioId], evento.autorUsuarioId);

        await this.despachar({
          tipo: TipoNotificacao.ATENDIMENTO_SOLICITADO,
          referenciaId: contexto.atendimentoId,
          destinatarios: monitor,
          dados: contexto,
          referenciasDeLink: { atendimentoId: contexto.atendimentoId },
        });
        return;
      }

      const monitorados = await this.monitoradosAtivos(contexto.monitoriaId, evento.autorUsuarioId);

      await this.despachar({
        tipo: TipoNotificacao.ATENDIMENTO_OFERTADO,
        referenciaId: contexto.atendimentoId,
        destinatarios: monitorados,
        dados: contexto,
        referenciasDeLink: { atendimentoId: contexto.atendimentoId },
        demaisSessoes: evento.demaisSessoes,
      });
    });
  }

  /**
   * A referencia e o HISTORICO, nao o atendimento — ver eventos.ts. O monitor
   * tambem recebe, porque o professor responsavel pode cancelar por ele.
   *
   * OS INSCRITOS VEM DO EVENTO, NAO DE UMA CONSULTA.
   *
   * E a unica forma correta aqui: cancelar o atendimento tambem cancela as
   * inscricoes, dentro da mesma transacao, para liberar a agenda dos alunos.
   * Quando este ouvinte roda, portanto, nao existe mais nenhum `INSCRITO` para
   * consultar. Fazer como as demais notificacoes fazem devolveria so o monitor,
   * e o aviso mais importante do sistema jamais alcancaria quem ia comparecer —
   * se o proprio monitor cancelasse, nao alcancaria ninguem.
   */
  @OnEvent(EVENTO_ATENDIMENTO_CANCELADO)
  async aoCancelar(evento: AtendimentoCanceladoEvento): Promise<void> {
    await this.protegido('cancelamento', async () => {
      const contexto = await this.contextoDoAtendimento(evento.atendimentoId);

      if (!contexto) {
        return;
      }

      const destinatarios = await this.usuarios(
        [contexto.monitorUsuarioId, ...evento.inscritosUsuarioIds],
        evento.autorUsuarioId,
      );

      await this.despachar({
        tipo: TipoNotificacao.ATENDIMENTO_CANCELADO,
        referenciaId: evento.historicoId,
        destinatarios,
        dados: contexto,
        referenciasDeLink: { atendimentoId: contexto.atendimentoId },
        motivo: evento.motivo,
      });
    });
  }

  @OnEvent(EVENTO_ATENDIMENTO_REAGENDADO)
  async aoReagendar(evento: AtendimentoReagendadoEvento): Promise<void> {
    await this.protegido('reagendamento', async () => {
      const contexto = await this.contextoDoAtendimento(evento.atendimentoId);

      if (!contexto) {
        return;
      }

      const destinatarios = await this.envolvidos(contexto, evento.autorUsuarioId);

      await this.despachar({
        tipo: TipoNotificacao.ATENDIMENTO_REAGENDADO,
        referenciaId: evento.historicoId,
        destinatarios,
        dados: contexto,
        referenciasDeLink: { atendimentoId: contexto.atendimentoId },
      });
    });
  }

  @OnEvent(EVENTO_MONITOR_HABILITADO)
  async aoHabilitarMonitor(evento: MonitorHabilitadoEvento): Promise<void> {
    await this.protegido('habilitacao de monitor', async () => {
      const [linha] = await this.consultar<{ disciplina: string }>(
        `SELECT d.nome AS disciplina
           FROM monitorias m
           JOIN disciplinas d ON d.id = m.disciplina_id
          WHERE m.id = :monitoriaId`,
        { monitoriaId: evento.monitoriaId },
      );

      if (!linha) {
        return;
      }

      const destinatarios = await this.usuarios([evento.alunoUsuarioId]);

      await this.despachar({
        tipo: TipoNotificacao.MONITOR_HABILITADO,
        referenciaId: evento.participanteId,
        destinatarios,
        dados: { ...this.contextoVazio(), disciplina: linha.disciplina },
        referenciasDeLink: { monitoriaId: evento.monitoriaId },
        inscricoesCanceladas: evento.inscricoesCanceladas,
      });
    });
  }

  /**
   * Aproveita o evento que a gamificacao ja consome: nenhuma emissao nova foi
   * precisa no nucleo para este tipo.
   *
   * A referencia e a INSCRICAO, nao o atendimento: um atendimento em grupo gera
   * um convite por presente, e cada um precisa da sua linha.
   */
  @OnEvent(EVENTO_ATENDIMENTO_REALIZADO)
  async aoRealizar(evento: AtendimentoRealizadoEvento): Promise<void> {
    await this.protegido('convite de avaliacao', async () => {
      const contexto = await this.contextoDoAtendimento(evento.atendimentoId);

      if (!contexto || evento.presentesParticipanteIds.length === 0) {
        return;
      }

      const presentes = await this.consultar<Destinatario & { inscricaoId: string }>(
        `SELECT ap.id       AS "inscricaoId",
                u.id        AS "usuarioId",
                u.nome      AS nome,
                u.email::text AS email
           FROM atendimento_participantes ap
           JOIN monitoria_participantes mp ON mp.id = ap.participante_id
           JOIN usuarios u ON u.id = mp.aluno_id
          WHERE ap.atendimento_id = :atendimentoId
            AND ap.participante_id IN (:participanteIds)
            AND u.ativo = true`,
        {
          atendimentoId: evento.atendimentoId,
          participanteIds: evento.presentesParticipanteIds,
        },
      );

      for (const presente of presentes) {
        await this.despachar({
          tipo: TipoNotificacao.AVALIACAO_PENDENTE,
          referenciaId: presente.inscricaoId,
          destinatarios: [presente],
          dados: contexto,
          referenciasDeLink: { atendimentoId: contexto.atendimentoId },
        });
      }
    });
  }

  // ------------------------------------------------------------------ ROTINAS

  /**
   * Lembrete dos atendimentos de HOJE.
   *
   * Roda a cada 15 minutos, e nao uma vez de manha, porque atendimento criado as
   * 14h para as 16h do mesmo dia tambem merece aviso — um disparo unico deixaria
   * esse caso de fora. Avisar varias vezes nao e risco: a UNIQUE garante um
   * aviso por pessoa por atendimento.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async lembrarAtendimentosDeHoje(): Promise<void> {
    if (!this.habilitadas()) {
      return;
    }

    await this.protegido('lembrete do dia', async () => {
      /**
       * "Hoje" e o dia da INSTITUICAO, nao o dia UTC.
       *
       * Com TIMEZONE_INSTITUICAO em America/Porto_Velho (UTC-4), um atendimento
       * as 20h do dia 13 e 00h UTC do dia 14. Comparar datas em UTC anunciaria
       * esse atendimento no dia errado — e so no fim da tarde, que e quando
       * ninguem esta olhando. A conversao fica no PostgreSQL (AT TIME ZONE),
       * como ja faz a validacao de disponibilidade.
       */
      const atendimentos = await this.consultar<{ id: string }>(
        `SELECT a.id
           FROM atendimentos a
          WHERE a.status = 'AGENDADO'
            AND a.inicio > now()
            AND (a.inicio AT TIME ZONE :fuso)::date = (now() AT TIME ZONE :fuso)::date`,
        { fuso: this.fuso() },
      );

      for (const { id } of atendimentos) {
        const contexto = await this.contextoDoAtendimento(id);

        if (!contexto) {
          continue;
        }

        /**
         * Monitor e inscritos sao buscados SEPARADAMENTE, e nao por
         * `envolvidos`, porque recebem textos diferentes: um conduz, os outros
         * comparecem. O numero de inscritos sai de graca daqui e e justamente
         * o dado que falta ao monitor para se preparar.
         */
        const inscritos = await this.inscritosAtivos(id);
        const monitor = await this.usuarios([contexto.monitorUsuarioId]);

        await this.despachar({
          tipo: TipoNotificacao.LEMBRETE_DIA,
          referenciaId: id,
          destinatarios: monitor,
          dados: contexto,
          referenciasDeLink: { atendimentoId: id },
          papel: PapelMonitoria.MONITOR,
          inscritos: inscritos.length,
        });

        await this.despachar({
          tipo: TipoNotificacao.LEMBRETE_DIA,
          referenciaId: id,
          destinatarios: inscritos,
          dados: contexto,
          referenciasDeLink: { atendimentoId: id },
          papel: PapelMonitoria.MONITORADO,
        });
      }
    });
  }

  /**
   * Reenvio do que ficou para tras.
   *
   * Uma indisponibilidade do provedor nao pode custar a notificacao: a linha ja
   * existe com o corpo gravado, entao reenviar e so tentar de novo. Sem isso, o
   * unico efeito de uma falha de rede seria um aviso perdido em silencio.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reenviarPendentes(): Promise<void> {
    if (!this.habilitadas()) {
      return;
    }

    await this.protegido('reenvio', async () => {
      const pendentes = await this.notificacaoModel.findAll({
        where: { enviadoEm: { [Op.is]: null }, tentativas: { [Op.lt]: MAX_TENTATIVAS } },
        order: [['createdAt', 'ASC']],
        limit: 50,
      });

      for (const pendente of pendentes) {
        await this.entregar(pendente);
      }
    });
  }

  // ------------------------------------------------------------------ NUCLEO

  /**
   * Reserva a linha, monta a mensagem e entrega. Nesta ordem.
   *
   * A reserva vir primeiro e o que garante o envio unico: duas instancias (ou
   * dois ticks sobrepostos) competem pelo INSERT, e quem perde para a UNIQUE
   * simplesmente nao envia. Se a ordem fosse "enviar e depois registrar", as
   * duas enviariam antes de descobrir a duplicata.
   */
  private async despachar(pedido: PedidoDeDespacho): Promise<void> {
    const { tipo, referenciaId, destinatarios, dados } = pedido;
    const link = montarLink(tipo, pedido.referenciasDeLink, this.urlFront());

    for (const destinatario of destinatarios) {
      const { assunto, corpo } = MENSAGENS[tipo]({
        nome: destinatario.nome,
        dados,
        fuso: this.fuso(),
        link,
        motivo: pedido.motivo,
        papel: pedido.papel,
        inscritos: pedido.inscritos,
        inscricoesCanceladas: pedido.inscricoesCanceladas,
        demaisSessoes: pedido.demaisSessoes,
      });

      let notificacao: Notificacao;

      try {
        notificacao = await this.notificacaoModel.create({
          usuarioId: destinatario.usuarioId,
          tipo,
          referenciaId,
          assunto: assunto.slice(0, 200),
          corpo,
        });
      } catch (erro) {
        if (erro instanceof UniqueConstraintError) {
          // Ja avisado. E o caminho normal quando a rotina roda de novo.
          continue;
        }

        throw erro;
      }

      await this.entregar(notificacao, destinatario.email, destinatario.nome);
    }
  }

  /**
   * Entrega uma linha ja reservada.
   *
   * O destinatario e opcional porque o reenvio parte apenas da linha: nesse caso
   * o e-mail e buscado do usuario, que pode ate ter mudado desde o primeiro
   * registro — e deve mesmo ser o atual.
   */
  private async entregar(notificacao: Notificacao, email?: string, nome?: string): Promise<void> {
    let destino = email;
    let pessoa = nome;

    if (!destino) {
      const [usuario] = await this.usuarios([notificacao.usuarioId]);

      if (!usuario) {
        return;
      }

      destino = usuario.email;
      pessoa = usuario.nome;
    }

    const enviou = await this.emailService.enviar({
      para: [{ email: destino, nome: pessoa }],
      assunto: notificacao.assunto,
      texto: notificacao.corpo,
    });

    await notificacao.update({
      tentativas: notificacao.tentativas + 1,
      ...(enviou ? { enviadoEm: new Date() } : {}),
    });
  }

  // ------------------------------------------------------------- DESTINATARIOS

  /**
   * Quem esta inscrito e vai comparecer.
   *
   * Extraido de `envolvidos` porque o lembrete do dia precisa dos inscritos
   * SEPARADOS do monitor: os dois recebem textos diferentes, e o numero de
   * inscritos entra no texto do monitor.
   */
  private async inscritosAtivos(atendimentoId: string): Promise<Destinatario[]> {
    return this.consultar<Destinatario>(
      `SELECT u.id AS "usuarioId", u.nome AS nome, u.email::text AS email
         FROM atendimento_participantes ap
         JOIN monitoria_participantes mp ON mp.id = ap.participante_id
         JOIN usuarios u ON u.id = mp.aluno_id
        WHERE ap.atendimento_id = :atendimentoId
          AND ap.status = 'INSCRITO'
          AND u.ativo = true`,
      { atendimentoId },
    );
  }

  /** Monitor + inscritos ativos. Quem agiu nao recebe aviso do proprio ato. */
  private async envolvidos(
    contexto: ContextoDeAtendimento,
    excluirUsuarioId?: string,
  ): Promise<Destinatario[]> {
    const inscritos = await this.inscritosAtivos(contexto.atendimentoId);
    const monitor = await this.usuarios([contexto.monitorUsuarioId]);

    return this.semRepetir([...monitor, ...inscritos], excluirUsuarioId);
  }

  private async monitoradosAtivos(
    monitoriaId: string,
    excluirUsuarioId?: string,
  ): Promise<Destinatario[]> {
    const linhas = await this.consultar<Destinatario>(
      `SELECT u.id AS "usuarioId", u.nome AS nome, u.email::text AS email
         FROM monitoria_participantes mp
         JOIN usuarios u ON u.id = mp.aluno_id
        WHERE mp.monitoria_id = :monitoriaId
          AND mp.papel = 'MONITORADO'
          AND mp.status = 'ATIVO'
          AND u.ativo = true`,
      { monitoriaId },
    );

    return this.semRepetir(linhas, excluirUsuarioId);
  }

  private async usuarios(ids: string[], excluirUsuarioId?: string): Promise<Destinatario[]> {
    if (ids.length === 0) {
      return [];
    }

    const linhas = await this.consultar<Destinatario>(
      `SELECT u.id AS "usuarioId", u.nome AS nome, u.email::text AS email
         FROM usuarios u
        WHERE u.id IN (:ids) AND u.ativo = true`,
      { ids },
    );

    return this.semRepetir(linhas, excluirUsuarioId);
  }

  /**
   * Um aluno pode aparecer duas vezes (monitor de uma turma e inscrito nela), e
   * a UNIQUE recusaria a segunda linha de qualquer forma — mas descartar aqui
   * evita uma ida ao banco so para colher a violacao.
   */
  private semRepetir(lista: Destinatario[], excluirUsuarioId?: string): Destinatario[] {
    const vistos = new Set<string>();

    return lista.filter((item) => {
      if (item.usuarioId === excluirUsuarioId || vistos.has(item.usuarioId)) {
        return false;
      }

      vistos.add(item.usuarioId);
      return true;
    });
  }

  // ------------------------------------------------------------------ APOIO

  private async contextoDoAtendimento(
    atendimentoId: string,
  ): Promise<ContextoDeAtendimento | null> {
    const [linha] = await this.consultar<{
      atendimentoId: string;
      monitoriaId: string;
      disciplina: string;
      inicio: Date;
      fim: Date;
      modalidade: string;
      local: string | null;
      monitor: string;
      monitorUsuarioId: string;
    }>(
      `SELECT a.id            AS "atendimentoId",
              a.monitoria_id  AS "monitoriaId",
              d.nome          AS disciplina,
              a.inicio        AS inicio,
              a.fim           AS fim,
              a.modalidade    AS modalidade,
              a.local         AS local,
              u.nome          AS monitor,
              u.id            AS "monitorUsuarioId"
         FROM atendimentos a
         JOIN monitorias m  ON m.id = a.monitoria_id
         JOIN disciplinas d ON d.id = m.disciplina_id
         JOIN monitoria_participantes mp ON mp.id = a.monitor_participante_id
         JOIN usuarios u ON u.id = mp.aluno_id
        WHERE a.id = :atendimentoId`,
      { atendimentoId },
    );

    return linha ?? null;
  }

  /** Base para o unico tipo que nao fala de um atendimento. */
  private contextoVazio(): DadosDoAtendimento {
    return {
      disciplina: '',
      inicio: new Date(),
      fim: new Date(),
      modalidade: '',
      local: null,
      monitor: '',
    };
  }

  private async consultar<T>(sql: string, replacements: Record<string, unknown>): Promise<T[]> {
    const linhas = await this.sequelize.query(sql, {
      replacements,
      type: QueryTypes.SELECT,
    });

    return linhas as T[];
  }

  private habilitadas(): boolean {
    return this.config.get<boolean>('notificacoes.habilitadas') === true;
  }

  private fuso(): string {
    return this.config.getOrThrow<string>('agenda.fusoHorario');
  }

  private urlFront(): string {
    return this.config.getOrThrow<string>('app.urlFront');
  }

  /**
   * Nenhuma falha de aviso escapa deste modulo.
   *
   * Os ouvintes rodam fora da requisicao que os originou: uma excecao aqui nao
   * tem para onde subir e viraria `unhandledRejection`, que derruba o processo
   * em Node moderno. Um atendimento cancelado continua cancelado mesmo que o
   * aviso falhe.
   */
  private async protegido(rotulo: string, acao: () => Promise<void>): Promise<void> {
    if (!this.habilitadas()) {
      return;
    }

    try {
      await acao();
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Falha ao notificar (${rotulo}): ${motivo}`);
    }
  }
}
