import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { StatusAtendimento } from '../../common/enums/status-atendimento.enum';
import { StatusMonitoria } from '../../common/enums/status-monitoria.enum';
import { StatusParticipacao } from '../../common/enums/status-participacao.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { Atendimento } from '../atendimentos/entities/atendimento.model';
import { DisciplinasService } from '../disciplinas/disciplinas.service';
import { Disciplina } from '../disciplinas/entities/disciplina.model';
import { Professor } from '../usuarios/entities/professor.model';
import { Usuario } from '../usuarios/entities/usuario.model';
import { AtualizarMonitoriaDto } from './dto/atualizar-monitoria.dto';
import { CriarMonitoriaDto } from './dto/criar-monitoria.dto';
import { FiltroMinhasMonitoriasDto, STATUS_EM_ANDAMENTO } from './dto/filtro-minhas-monitorias.dto';
import { FiltroMonitoriasDto } from './dto/filtro-monitorias.dto';
import { MonitoriaRespostaDto } from './dto/monitoria-resposta.dto';
import { Monitoria } from './entities/monitoria.model';
import { MonitoriaParticipante } from './entities/monitoria-participante.model';
import { ParticipacaoService } from './participacao.service';

/**
 * Transicoes permitidas do ciclo de vida da monitoria.
 *
 * Declarado como dado, e nao como sequencia de ifs espalhados: e o unico lugar
 * onde a maquina de estados existe, o que torna impossivel um caminho de codigo
 * "esquecer" uma regra de transicao.
 */
const TRANSICOES_PERMITIDAS: Record<StatusMonitoria, StatusMonitoria[]> = {
  [StatusMonitoria.PLANEJADA]: [StatusMonitoria.ATIVA, StatusMonitoria.CANCELADA],
  [StatusMonitoria.ATIVA]: [StatusMonitoria.ENCERRADA, StatusMonitoria.CANCELADA],
  [StatusMonitoria.ENCERRADA]: [],
  [StatusMonitoria.CANCELADA]: [],
};

const INCLUDE_PADRAO = [
  Disciplina,
  { model: Professor, include: [{ model: Usuario, attributes: ['id', 'nome'] }] },
];

@Injectable()
export class MonitoriasService {
  constructor(
    @InjectModel(Monitoria) private readonly monitoriaModel: typeof Monitoria,
    @InjectModel(MonitoriaParticipante)
    private readonly participanteModel: typeof MonitoriaParticipante,
    @InjectModel(Atendimento) private readonly atendimentoModel: typeof Atendimento,
    private readonly disciplinasService: DisciplinasService,
    private readonly participacaoService: ParticipacaoService,
  ) {}

  async criar(
    dto: CriarMonitoriaDto,
    professor: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    const disciplina = await this.disciplinasService.buscarOuFalhar(dto.disciplinaId);

    if (!disciplina.ativa) {
      throw new BadRequestException('Nao e possivel criar monitoria de uma disciplina inativa.');
    }

    this.validarVigencia(dto.dataInicio, dto.dataFim);

    /**
     * O professor responsavel e SEMPRE o usuario autenticado, nunca um campo do
     * corpo. Aceitar `professorId` do cliente permitiria criar monitoria em nome
     * de terceiros e, por tabela, habilitar monitores no lugar de outro docente.
     */
    const monitoria = await this.monitoriaModel.create({
      disciplinaId: dto.disciplinaId,
      professorId: professor.id,
      ano: dto.ano,
      semestre: dto.semestre,
      descricao: dto.descricao ?? null,
      dataInicio: dto.dataInicio ?? null,
      dataFim: dto.dataFim ?? null,
      status: StatusMonitoria.PLANEJADA,
    });

    return this.detalhar(monitoria.id);
  }

  async listar(filtro: FiltroMonitoriasDto): Promise<RespostaPaginada<MonitoriaRespostaDto>> {
    const where: Record<string, unknown> = {};

    if (filtro.disciplinaId) where.disciplinaId = filtro.disciplinaId;
    if (filtro.professorId) where.professorId = filtro.professorId;
    if (filtro.ano) where.ano = filtro.ano;
    if (filtro.semestre) where.semestre = filtro.semestre;
    if (filtro.status) where.status = filtro.status;

    if (filtro.busca) {
      const padrao = `%${filtro.busca}%`;

      // `$associacao.coluna$` filtra por colunas das tabelas ja incluidas em
      // INCLUDE_PADRAO, sem precisar de subconsulta nem de join extra.
      where[Op.or as unknown as string] = [
        { '$disciplina.codigo$': { [Op.iLike]: padrao } },
        { '$disciplina.nome$': { [Op.iLike]: padrao } },
        { '$professor.usuario.nome$': { [Op.iLike]: padrao } },
      ];
    }

    const { rows, count } = await this.monitoriaModel.findAndCountAll({
      where,
      include: INCLUDE_PADRAO,
      // Necessario para que o WHERE alcance as colunas das tabelas incluidas
      // quando ha LIMIT: sem isso o Sequelize gera uma subconsulta que nao
      // enxerga os joins.
      subQuery: false,
      order: [
        ['ano', 'DESC'],
        ['semestre', 'DESC'],
        ['created_at', 'DESC'],
      ],
      limit: filtro.limite,
      offset: filtro.offset,
      distinct: true,
    });

    return new RespostaPaginada(
      rows.map((m) => MonitoriaRespostaDto.deModelo(m)),
      count,
      filtro.pagina,
      filtro.limite,
    );
  }

  async detalhar(monitoriaId: string, usuario?: UsuarioAutenticado): Promise<MonitoriaRespostaDto> {
    const monitoria = await this.monitoriaModel.findByPk(monitoriaId, {
      include: INCLUDE_PADRAO,
    });

    if (!monitoria) {
      await this.participacaoService.buscarMonitoriaOuFalhar(monitoriaId);
    }

    if (!usuario) {
      return MonitoriaRespostaDto.deModelo(monitoria!);
    }

    const contexto = await this.participacaoService.obterContexto(monitoriaId, usuario);

    return MonitoriaRespostaDto.deModelo(monitoria!, {
      meuPapel: contexto.papel,
      souResponsavel: contexto.ehProfessorResponsavel,
      meuParticipanteId: contexto.participacao?.id ?? null,
    });
  }

  /**
   * Monitorias em que o usuario esta envolvido, como responsavel ou como
   * participante — cada uma anotada com o papel dele NAQUELE contexto.
   *
   * E a consulta que demonstra o modelo funcionando: o mesmo usuario pode
   * aparecer como MONITOR em uma linha e MONITORADO em outra.
   *
   * Paginada e filtrada porque alimenta o dashboard e cresce a cada semestre:
   * sem limite, um professor com anos de historico receberia tudo em uma
   * resposta so. O default traz apenas o que esta em andamento (ver
   * STATUS_EM_ANDAMENTO); o historico e acessivel pedindo os status terminais.
   */
  async minhas(
    usuario: UsuarioAutenticado,
    filtro: FiltroMinhasMonitoriasDto,
  ): Promise<RespostaPaginada<MonitoriaRespostaDto>> {
    // Vinculos ativos: sao eles que dizem em qual papel o usuario aparece.
    const participacoes = await this.participanteModel.findAll({
      where: { alunoId: usuario.id, status: StatusParticipacao.ATIVO },
      attributes: ['monitoriaId', 'papel', 'id'],
    });

    const contextoPorMonitoria = new Map(
      participacoes.map((p) => [p.monitoriaId, { papel: p.papel, participanteId: p.id }]),
    );

    const where: Record<string, unknown> = {
      [Op.or]: [{ professorId: usuario.id }, { id: { [Op.in]: [...contextoPorMonitoria.keys()] } }],
      status: { [Op.in]: filtro.status ?? STATUS_EM_ANDAMENTO },
    };

    if (filtro.ano) where.ano = filtro.ano;
    if (filtro.semestre) where.semestre = filtro.semestre;

    const { rows, count } = await this.monitoriaModel.findAndCountAll({
      where,
      include: INCLUDE_PADRAO,
      order: [
        ['ano', 'DESC'],
        ['semestre', 'DESC'],
      ],
      limit: filtro.limite,
      offset: filtro.offset,
      distinct: true,
    });

    const dados = rows.map((m) => {
      const contexto = contextoPorMonitoria.get(m.id);

      return MonitoriaRespostaDto.deModelo(m, {
        meuPapel: contexto?.papel ?? null,
        souResponsavel: m.professorId === usuario.id,
        meuParticipanteId: contexto?.participanteId ?? null,
      });
    });

    return new RespostaPaginada(dados, count, filtro.pagina, filtro.limite);
  }

  async atualizar(
    monitoriaId: string,
    dto: AtualizarMonitoriaDto,
    usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    const { monitoria } = await this.participacaoService.exigirProfessorResponsavel(
      monitoriaId,
      usuario,
    );

    if (this.ehTerminal(monitoria.status)) {
      throw new ConflictException(
        `Monitoria ${monitoria.status.toLowerCase()} nao pode mais ser editada.`,
      );
    }

    const dataInicio = dto.dataInicio ?? monitoria.dataInicio;
    const dataFim = dto.dataFim ?? monitoria.dataFim;
    this.validarVigencia(dataInicio, dataFim);

    await monitoria.update({
      ...(dto.descricao !== undefined ? { descricao: dto.descricao } : {}),
      ...(dto.dataInicio !== undefined ? { dataInicio: dto.dataInicio } : {}),
      ...(dto.dataFim !== undefined ? { dataFim: dto.dataFim } : {}),
    });

    return this.detalhar(monitoriaId, usuario);
  }

  /** PLANEJADA -> ATIVA. So a partir daqui a monitoria aceita atendimentos. */
  async ativar(monitoriaId: string, usuario: UsuarioAutenticado): Promise<MonitoriaRespostaDto> {
    const { monitoria } = await this.participacaoService.exigirProfessorResponsavel(
      monitoriaId,
      usuario,
    );

    this.exigirTransicao(monitoria.status, StatusMonitoria.ATIVA);
    await monitoria.update({ status: StatusMonitoria.ATIVA });

    return this.detalhar(monitoriaId, usuario);
  }

  /**
   * ATIVA -> ENCERRADA, encerrando os vinculos ativos.
   *
   * Encerrar e um ato de arquivamento: nada e apagado. Os participantes passam a
   * ENCERRADO com data, e todo o historico de atendimentos permanece consultavel
   * (RN10).
   */
  async encerrar(monitoriaId: string, usuario: UsuarioAutenticado): Promise<MonitoriaRespostaDto> {
    return this.finalizar(monitoriaId, usuario, StatusMonitoria.ENCERRADA, null);
  }

  /** PLANEJADA|ATIVA -> CANCELADA. Exige motivo, registrado na descricao do encerramento. */
  async cancelar(
    monitoriaId: string,
    usuario: UsuarioAutenticado,
    motivo: string,
  ): Promise<MonitoriaRespostaDto> {
    return this.finalizar(monitoriaId, usuario, StatusMonitoria.CANCELADA, motivo);
  }

  private async finalizar(
    monitoriaId: string,
    usuario: UsuarioAutenticado,
    destino: StatusMonitoria,
    motivo: string | null,
  ): Promise<MonitoriaRespostaDto> {
    const { monitoria } = await this.participacaoService.exigirProfessorResponsavel(
      monitoriaId,
      usuario,
    );

    this.exigirTransicao(monitoria.status, destino);

    /**
     * Bloqueio deliberado: encerrar ou cancelar uma monitoria com atendimentos
     * ainda AGENDADOS cancelaria compromissos das pessoas sem que ninguem
     * decidisse isso explicitamente. Em vez de cascatear em silencio, exigimos
     * que o professor resolva cada atendimento — cada cancelamento fica no
     * historico com autor e motivo proprios.
     */
    const agendados = await this.atendimentoModel.count({
      where: { monitoriaId, status: StatusAtendimento.AGENDADO },
    });

    if (agendados > 0) {
      throw new ConflictException(
        `Existem ${agendados} atendimento(s) AGENDADO(s). Cancele-os antes de ` +
          `${destino === StatusMonitoria.CANCELADA ? 'cancelar' : 'encerrar'} a monitoria.`,
      );
    }

    await this.monitoriaModel.sequelize!.transaction(async (transaction) => {
      await monitoria.update(
        {
          status: destino,
          descricao:
            motivo && destino === StatusMonitoria.CANCELADA
              ? `${monitoria.descricao ? `${monitoria.descricao}\n\n` : ''}[CANCELAMENTO] ${motivo}`
              : monitoria.descricao,
        },
        { transaction },
      );

      // Encerra os vinculos SEM remove-los: o historico de quem participou e
      // de quando participou continua intacto.
      await this.participanteModel.update(
        { status: StatusParticipacao.ENCERRADO, encerradoEm: new Date() },
        { where: { monitoriaId, status: StatusParticipacao.ATIVO }, transaction },
      );
    });

    return this.detalhar(monitoriaId, usuario);
  }

  /** Usado por Disponibilidades e Atendimentos: so monitoria ATIVA opera. */
  exigirMonitoriaAtiva(monitoria: Monitoria): void {
    if (monitoria.status !== StatusMonitoria.ATIVA) {
      throw new ConflictException(
        `Esta operacao exige monitoria ATIVA. Status atual: ${monitoria.status}.`,
      );
    }
  }

  contarPorPapel(monitoriaId: string, papel: PapelMonitoria): Promise<number> {
    return this.participanteModel.count({
      where: { monitoriaId, papel, status: StatusParticipacao.ATIVO },
    });
  }

  private ehTerminal(status: StatusMonitoria): boolean {
    return TRANSICOES_PERMITIDAS[status].length === 0;
  }

  private exigirTransicao(atual: StatusMonitoria, destino: StatusMonitoria): void {
    if (!TRANSICOES_PERMITIDAS[atual].includes(destino)) {
      throw new ConflictException(`Transicao invalida: ${atual} -> ${destino}.`);
    }
  }

  private validarVigencia(inicio?: string | null, fim?: string | null): void {
    if (inicio && fim && fim < inicio) {
      throw new BadRequestException('dataFim nao pode ser anterior a dataInicio.');
    }
  }
}
