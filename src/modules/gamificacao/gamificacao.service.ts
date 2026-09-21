import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, UniqueConstraintError } from 'sequelize';

import { TipoPontuacao } from '../../common/enums/tipo-pontuacao.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { MonitoriaParticipante } from '../monitorias/entities/monitoria-participante.model';
import { PosicaoRankingDto, ResumoPontuacaoDto } from './dto/ranking-resposta.dto';
import { PontuacaoEvento } from './entities/pontuacao-evento.model';
import {
  AtendimentoRealizadoEvento,
  AvaliacaoRegistradaEvento,
  EVENTO_ATENDIMENTO_REALIZADO,
  EVENTO_AVALIACAO_REGISTRADA,
} from './eventos';

/**
 * Tabela de pontos.
 *
 * Fica em um unico lugar, como dado, para que ajustar o balanceamento nao exija
 * caçar numeros espalhados por services. Quando virar configuracao por
 * instituicao, este objeto vira a fonte do default.
 */
const PONTOS: Record<TipoPontuacao, number> = {
  [TipoPontuacao.ATENDIMENTO_REALIZADO]: 10,
  [TipoPontuacao.PARTICIPACAO_ATENDIMENTO]: 5,
  // AVALIACAO_RECEBIDA usa a propria nota (1 a 5) como pontuacao.
  [TipoPontuacao.AVALIACAO_RECEBIDA]: 0,
};

@Injectable()
export class GamificacaoService {
  private readonly logger = new Logger(GamificacaoService.name);

  constructor(
    @InjectModel(PontuacaoEvento) private readonly pontuacaoModel: typeof PontuacaoEvento,
    @InjectModel(MonitoriaParticipante)
    private readonly participanteModel: typeof MonitoriaParticipante,
  ) {}

  /**
   * Atendimento concluido -> pontuacao.
   *
   * Roda como OUVINTE: o AtendimentosService nao conhece esta classe. Falhas aqui
   * sao registradas e engolidas de proposito — se a pontuacao quebrar, o
   * atendimento continua realizado. Gamificacao nao pode derrubar o nucleo.
   */
  @OnEvent(EVENTO_ATENDIMENTO_REALIZADO)
  async aoRealizarAtendimento(evento: AtendimentoRealizadoEvento): Promise<void> {
    try {
      await this.conceder(
        evento.monitorParticipanteId,
        evento.monitoriaId,
        TipoPontuacao.ATENDIMENTO_REALIZADO,
        PONTOS[TipoPontuacao.ATENDIMENTO_REALIZADO],
        evento.atendimentoId,
      );

      for (const participanteId of evento.presentesParticipanteIds) {
        await this.conceder(
          participanteId,
          evento.monitoriaId,
          TipoPontuacao.PARTICIPACAO_ATENDIMENTO,
          PONTOS[TipoPontuacao.PARTICIPACAO_ATENDIMENTO],
          evento.atendimentoId,
        );
      }
    } catch (erro) {
      this.logger.error(
        `Falha ao pontuar o atendimento ${evento.atendimentoId}`,
        erro instanceof Error ? erro.stack : String(erro),
      );
    }
  }

  /** Avaliacao registrada -> o monitor recebe pontos proporcionais a nota. */
  @OnEvent(EVENTO_AVALIACAO_REGISTRADA)
  async aoRegistrarAvaliacao(evento: AvaliacaoRegistradaEvento): Promise<void> {
    try {
      await this.conceder(
        evento.monitorParticipanteId,
        evento.monitoriaId,
        TipoPontuacao.AVALIACAO_RECEBIDA,
        evento.nota,
        evento.avaliacaoId,
      );
    } catch (erro) {
      this.logger.error(
        `Falha ao pontuar a avaliacao ${evento.avaliacaoId}`,
        erro instanceof Error ? erro.stack : String(erro),
      );
    }
  }

  /**
   * Registra os pontos de um participante.
   *
   * O evento guarda `usuario_id`, nao `participante_id`: pontos pertencem a
   * PESSOA e a acompanham entre monitorias e periodos, enquanto o vinculo e
   * encerrado ao fim do semestre. Por isso resolvemos o vinculo para o aluno aqui.
   *
   * Concessao duplicada e recusada pela UNIQUE (tipo, referencia, usuario) e
   * tratada como no-op — o ouvinte pode ser reprocessado sem inflar pontuacao.
   */
  private async conceder(
    participanteId: string,
    monitoriaId: string,
    tipo: TipoPontuacao,
    pontos: number,
    referenciaId: string,
  ): Promise<void> {
    if (pontos <= 0) {
      return;
    }

    const participante = await this.participanteModel.findByPk(participanteId, {
      attributes: ['id', 'alunoId'],
    });

    if (!participante) {
      this.logger.warn(`Participante ${participanteId} nao encontrado; pontuacao ignorada.`);
      return;
    }

    try {
      await this.pontuacaoModel.create({
        usuarioId: participante.alunoId,
        monitoriaId,
        tipo,
        pontos,
        referenciaId,
        criadoEm: new Date(),
      });
    } catch (erro) {
      if (erro instanceof UniqueConstraintError) {
        this.logger.debug(`Pontuacao ${tipo}/${referenciaId} ja concedida; ignorando.`);
        return;
      }

      throw erro;
    }
  }

  /**
   * Ranking por soma de pontos.
   *
   * Agregacao ao vivo, sem tabela de placar materializada. Com o volume de uma
   * plataforma de monitoria, a soma indexada e barata; uma tabela de saldo
   * introduziria o problema de mante-la em sincronia sem ganho real.
   */
  async ranking(limite = 20, monitoriaId?: string): Promise<PosicaoRankingDto[]> {
    const linhas = await this.pontuacaoModel.sequelize!.query<{
      usuario_id: string;
      nome: string;
      total: string;
      eventos: string;
    }>(
      `
      SELECT p.usuario_id, u.nome, SUM(p.pontos) AS total, COUNT(*) AS eventos
        FROM pontuacao_eventos p
        JOIN usuarios u ON u.id = p.usuario_id
       WHERE (:monitoriaId::uuid IS NULL OR p.monitoria_id = :monitoriaId::uuid)
       GROUP BY p.usuario_id, u.nome
       ORDER BY total DESC, u.nome ASC
       LIMIT :limite;
      `,
      {
        replacements: { monitoriaId: monitoriaId ?? null, limite },
        type: QueryTypes.SELECT,
      },
    );

    return linhas.map((linha, indice) => ({
      posicao: indice + 1,
      usuarioId: linha.usuario_id,
      nome: linha.nome,
      pontos: Number(linha.total),
      eventos: Number(linha.eventos),
    }));
  }

  /**
   * Extrato do proprio usuario.
   *
   * O total e o `porTipo` sao agregados PELO BANCO, sobre todos os eventos.
   * A versao anterior somava em memoria as 100 linhas mais recentes, o que fazia
   * um usuario com mais de 100 eventos ver no proprio extrato um total MENOR do
   * que o que o /ranking exibia para ele — o ranking sempre somou via SQL.
   * Duas telas, dois numeros, mesma pessoa.
   *
   * O `limite` agora se aplica apenas a `ultimosEventos`, que e a unica parte
   * legitimamente paginavel desta resposta.
   */
  async meusPontos(
    usuario: UsuarioAutenticado,
    monitoriaId?: string,
    limite = 20,
  ): Promise<ResumoPontuacaoDto> {
    const replacements = { usuarioId: usuario.id, monitoriaId: monitoriaId ?? null };

    const totais = (await this.pontuacaoModel.sequelize!.query(
      `
      SELECT tipo, SUM(pontos) AS total
        FROM pontuacao_eventos
       WHERE usuario_id = :usuarioId
         AND (:monitoriaId::uuid IS NULL OR monitoria_id = :monitoriaId::uuid)
       GROUP BY tipo;
      `,
      { replacements, type: QueryTypes.SELECT },
    )) as unknown as { tipo: string; total: string }[];

    const porTipo = totais.reduce<Record<string, number>>((acumulado, linha) => {
      acumulado[linha.tipo] = Number(linha.total);
      return acumulado;
    }, {});

    const where: Record<string, unknown> = { usuarioId: usuario.id };

    if (monitoriaId) {
      where.monitoriaId = monitoriaId;
    }

    const ultimosEventos = await this.pontuacaoModel.findAll({
      where,
      order: [['criado_em', 'DESC']],
      limit: limite,
    });

    return {
      usuarioId: usuario.id,
      total: Object.values(porTipo).reduce((soma, pontos) => soma + pontos, 0),
      porTipo,
      ultimosEventos: ultimosEventos.map((evento) => ({
        tipo: evento.tipo,
        pontos: evento.pontos,
        monitoriaId: evento.monitoriaId,
        referenciaId: evento.referenciaId,
        criadoEm: evento.criadoEm,
      })),
    };
  }
}
