import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { StatusAtendimento } from '../../common/enums/status-atendimento.enum';
import { StatusMonitoria } from '../../common/enums/status-monitoria.enum';
import {
  AtividadeMonitorDto,
  ContagemPorStatusDto,
  IndicadoresMonitoriaDto,
  IndicadoresPlataformaDto,
} from './dto/indicadores.dto';

/**
 * Indicadores por agregacao ao vivo.
 *
 * Nao ha tabela de metricas pre-calculada, nem job de ETL. Com o volume de uma
 * plataforma de monitoria (dezenas de monitorias, milhares de atendimentos), as
 * agregacoes correm sobre indices existentes e respondem em milissegundos.
 * Materializar agora criaria o problema de invalidacao sem resolver nenhum
 * problema real de desempenho.
 *
 * Este service e SOMENTE LEITURA e usa SQL direto: sao consultas de agregacao
 * com varios JOINs, e escreve-las no query builder do ORM deixaria o que esta
 * sendo contado bem menos evidente do que o SQL.
 */
@Injectable()
export class AnalyticsService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /**
   * Visao da plataforma. Restrita a PROFESSOR (ver controller).
   *
   * Devolve apenas numeros agregados — nenhum nome, e-mail ou matricula. Com
   * `apenasMinhas`, o professor ve so o recorte das monitorias dele.
   */
  async plataforma(professorId: string, apenasMinhas: boolean): Promise<IndicadoresPlataformaDto> {
    const filtro = apenasMinhas ? 'WHERE m.professor_id = :professorId' : '';
    const replacements = { professorId };

    const linhasMonitorias = (await this.sequelize.query<{ status: string; total: string }>(
      `SELECT m.status, COUNT(*) AS total FROM monitorias m ${filtro} GROUP BY m.status;`,
      { replacements, type: QueryTypes.SELECT },
    )) as unknown as { status: string; total: string }[];

    const linhasAtendimentos = (await this.sequelize.query<{ status: string; total: string }>(
      `SELECT a.status, COUNT(*) AS total
         FROM atendimentos a
         JOIN monitorias m ON m.id = a.monitoria_id
         ${filtro}
        GROUP BY a.status;`,
      { replacements, type: QueryTypes.SELECT },
    )) as unknown as { status: string; total: string }[];

    const totais = (await this.sequelize.query<{
      alunos_atendidos: string;
      monitores: string;
      monitorados: string;
      total_avaliacoes: string;
      media_avaliacoes: string | null;
      pontos: string | null;
    }>(
      `
      SELECT
        (SELECT COUNT(DISTINCT mp.aluno_id)
           FROM atendimento_participantes ap
           JOIN monitoria_participantes mp ON mp.id = ap.participante_id
           JOIN monitorias m ON m.id = ap.monitoria_id
          WHERE ap.status = 'PRESENTE' ${apenasMinhas ? 'AND m.professor_id = :professorId' : ''}
        ) AS alunos_atendidos,

        (SELECT COUNT(*) FROM monitoria_participantes mp
           JOIN monitorias m ON m.id = mp.monitoria_id
          WHERE mp.status = 'ATIVO' AND mp.papel = 'MONITOR'
            ${apenasMinhas ? 'AND m.professor_id = :professorId' : ''}
        ) AS monitores,

        (SELECT COUNT(*) FROM monitoria_participantes mp
           JOIN monitorias m ON m.id = mp.monitoria_id
          WHERE mp.status = 'ATIVO' AND mp.papel = 'MONITORADO'
            ${apenasMinhas ? 'AND m.professor_id = :professorId' : ''}
        ) AS monitorados,

        (SELECT COUNT(*) FROM avaliacoes av
           JOIN atendimento_participantes ap ON ap.id = av.atendimento_participante_id
           JOIN monitorias m ON m.id = ap.monitoria_id
          ${apenasMinhas ? 'WHERE m.professor_id = :professorId' : ''}
        ) AS total_avaliacoes,

        (SELECT ROUND(AVG(av.nota), 2) FROM avaliacoes av
           JOIN atendimento_participantes ap ON ap.id = av.atendimento_participante_id
           JOIN monitorias m ON m.id = ap.monitoria_id
          ${apenasMinhas ? 'WHERE m.professor_id = :professorId' : ''}
        ) AS media_avaliacoes,

        (SELECT COALESCE(SUM(pe.pontos), 0) FROM pontuacao_eventos pe
           JOIN monitorias m ON m.id = pe.monitoria_id
          ${apenasMinhas ? 'WHERE m.professor_id = :professorId' : ''}
        ) AS pontos;
      `,
      { replacements, type: QueryTypes.SELECT, plain: true },
    )) as unknown as {
      alunos_atendidos: string;
      monitores: string;
      monitorados: string;
      total_avaliacoes: string;
      media_avaliacoes: string | null;
      pontos: string | null;
    };

    return {
      monitorias: this.contar(linhasMonitorias, Object.values(StatusMonitoria)),
      atendimentos: this.contar(linhasAtendimentos, Object.values(StatusAtendimento)),
      alunosAtendidos: Number(totais.alunos_atendidos),
      monitoresAtivos: Number(totais.monitores),
      monitoradosAtivos: Number(totais.monitorados),
      totalAvaliacoes: Number(totais.total_avaliacoes),
      mediaAvaliacoes: totais.media_avaliacoes === null ? null : Number(totais.media_avaliacoes),
      pontosDistribuidos: Number(totais.pontos ?? 0),
    };
  }

  /** Indicadores de UMA monitoria. Acesso controlado pelo ParticipacaoGuard. */
  async monitoria(monitoriaId: string): Promise<IndicadoresMonitoriaDto> {
    const cabecalho = (await this.sequelize.query(
      `
      SELECT m.id, m.status, m.ano, m.semestre, d.codigo, d.nome
        FROM monitorias m
        JOIN disciplinas d ON d.id = m.disciplina_id
       WHERE m.id = :monitoriaId;
      `,
      { replacements: { monitoriaId }, type: QueryTypes.SELECT, plain: true },
    )) as unknown as {
      id: string;
      status: string;
      ano: number;
      semestre: number;
      codigo: string;
      nome: string;
    } | null;

    if (!cabecalho) {
      throw new NotFoundException('Monitoria nao encontrada.');
    }

    const linhasAtendimentos = (await this.sequelize.query(
      `SELECT status, COUNT(*) AS total FROM atendimentos
        WHERE monitoria_id = :monitoriaId GROUP BY status;`,
      { replacements: { monitoriaId }, type: QueryTypes.SELECT },
    )) as unknown as { status: string; total: string }[];

    const numeros = (await this.sequelize.query(
      `
      SELECT
        (SELECT COUNT(*) FROM monitoria_participantes
          WHERE monitoria_id = :monitoriaId AND status = 'ATIVO' AND papel = 'MONITOR'
        ) AS monitores,
        (SELECT COUNT(*) FROM monitoria_participantes
          WHERE monitoria_id = :monitoriaId AND status = 'ATIVO' AND papel = 'MONITORADO'
        ) AS monitorados,
        (SELECT COUNT(DISTINCT mp.aluno_id)
           FROM atendimento_participantes ap
           JOIN monitoria_participantes mp ON mp.id = ap.participante_id
          WHERE ap.monitoria_id = :monitoriaId AND ap.status = 'PRESENTE'
        ) AS alunos_atendidos,
        (SELECT COUNT(*) FROM atendimento_participantes
          WHERE monitoria_id = :monitoriaId AND status = 'AUSENTE'
        ) AS ausencias,
        (SELECT COUNT(*) FROM avaliacoes av
           JOIN atendimento_participantes ap ON ap.id = av.atendimento_participante_id
          WHERE ap.monitoria_id = :monitoriaId
        ) AS total_avaliacoes,
        (SELECT ROUND(AVG(av.nota), 2) FROM avaliacoes av
           JOIN atendimento_participantes ap ON ap.id = av.atendimento_participante_id
          WHERE ap.monitoria_id = :monitoriaId
        ) AS media_avaliacoes,
        (SELECT COUNT(*) FROM materiais
          WHERE monitoria_id = :monitoriaId AND removido_em IS NULL
        ) AS materiais;
      `,
      { replacements: { monitoriaId }, type: QueryTypes.SELECT, plain: true },
    )) as unknown as {
      monitores: string;
      monitorados: string;
      alunos_atendidos: string;
      ausencias: string;
      total_avaliacoes: string;
      media_avaliacoes: string | null;
      materiais: string;
    };

    const monitoradosAtivos = Number(numeros.monitorados);
    const alunosAtendidos = Number(numeros.alunos_atendidos);

    return {
      monitoriaId: cabecalho.id,
      disciplina: `${cabecalho.codigo} - ${cabecalho.nome}`,
      periodo: `${cabecalho.ano}/${cabecalho.semestre}`,
      status: cabecalho.status,
      atendimentos: this.contar(linhasAtendimentos, Object.values(StatusAtendimento)),
      monitoresAtivos: Number(numeros.monitores),
      monitoradosAtivos,
      alunosAtendidos,
      // Divisao protegida: monitoria sem inscritos devolve 0, nao NaN — que
      // quebraria o JSON e, do outro lado, o grafico.
      taxaParticipacao:
        monitoradosAtivos === 0 ? 0 : Number((alunosAtendidos / monitoradosAtivos).toFixed(2)),
      ausencias: Number(numeros.ausencias),
      totalAvaliacoes: Number(numeros.total_avaliacoes),
      mediaAvaliacoes: numeros.media_avaliacoes === null ? null : Number(numeros.media_avaliacoes),
      materiaisPublicados: Number(numeros.materiais),
    };
  }

  /** Atividade de cada monitor da monitoria. Base do acompanhamento do professor. */
  async monitores(monitoriaId: string): Promise<AtividadeMonitorDto[]> {
    const linhas = (await this.sequelize.query(
      `
      SELECT
        mp.id            AS participante_id,
        mp.aluno_id      AS usuario_id,
        u.nome           AS nome,
        COUNT(*) FILTER (WHERE a.status = 'REALIZADO') AS realizados,
        COUNT(*) FILTER (WHERE a.status = 'CANCELADO') AS cancelados,
        COUNT(*) FILTER (WHERE a.status = 'AGENDADO')  AS agendados,
        (SELECT COUNT(*) FROM atendimento_participantes ap
           JOIN atendimentos a2 ON a2.id = ap.atendimento_id
          WHERE a2.monitor_participante_id = mp.id AND ap.status = 'PRESENTE'
        ) AS alunos_atendidos,
        (SELECT COUNT(*) FROM avaliacoes av
           JOIN atendimento_participantes ap ON ap.id = av.atendimento_participante_id
           JOIN atendimentos a3 ON a3.id = ap.atendimento_id
          WHERE a3.monitor_participante_id = mp.id
        ) AS total_avaliacoes,
        (SELECT ROUND(AVG(av.nota), 2) FROM avaliacoes av
           JOIN atendimento_participantes ap ON ap.id = av.atendimento_participante_id
           JOIN atendimentos a4 ON a4.id = ap.atendimento_id
          WHERE a4.monitor_participante_id = mp.id
        ) AS media_avaliacoes,
        (SELECT COUNT(*) FROM disponibilidades d
          WHERE d.participante_id = mp.id AND d.ativa
        ) AS disponibilidades
      FROM monitoria_participantes mp
      JOIN usuarios u ON u.id = mp.aluno_id
      LEFT JOIN atendimentos a ON a.monitor_participante_id = mp.id
      WHERE mp.monitoria_id = :monitoriaId AND mp.papel = 'MONITOR'
      GROUP BY mp.id, mp.aluno_id, u.nome
      ORDER BY realizados DESC, u.nome ASC;
      `,
      { replacements: { monitoriaId }, type: QueryTypes.SELECT },
    )) as unknown as Record<string, string>[];

    return linhas.map((linha) => ({
      participanteId: linha.participante_id,
      usuarioId: linha.usuario_id,
      nome: linha.nome,
      atendimentosRealizados: Number(linha.realizados),
      atendimentosCancelados: Number(linha.cancelados),
      atendimentosAgendados: Number(linha.agendados),
      alunosAtendidos: Number(linha.alunos_atendidos),
      totalAvaliacoes: Number(linha.total_avaliacoes),
      mediaAvaliacoes: linha.media_avaliacoes === null ? null : Number(linha.media_avaliacoes),
      disponibilidadesAtivas: Number(linha.disponibilidades),
    }));
  }

  /**
   * Preenche com zero os status que nao apareceram na consulta.
   *
   * Sem isso, um grafico do frontend teria barras faltando em vez de barras em
   * zero — e "nao existe" e "existe e vale zero" sao coisas diferentes.
   */
  private contar(
    linhas: { status: string; total: string }[],
    todos: string[],
  ): ContagemPorStatusDto {
    const porStatus = Object.fromEntries(todos.map((status) => [status, 0]));
    let total = 0;

    for (const linha of linhas) {
      const valor = Number(linha.total);
      porStatus[linha.status] = valor;
      total += valor;
    }

    return { total, porStatus };
  }
}
