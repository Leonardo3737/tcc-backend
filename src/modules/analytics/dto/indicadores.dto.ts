import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Formatos pensados para consumo direto pelo frontend Next.js.
 *
 * Os contadores por status vem como objeto chaveado pelo enum, e nao como lista
 * de pares, para que a tela leia `porStatus.AGENDADO` sem precisar procurar. Os
 * status ausentes vem com zero — assim um grafico nunca tem barra faltando.
 */
export class ContagemPorStatusDto {
  @ApiProperty({ example: 12 }) total: number;
  @ApiProperty({ example: { AGENDADO: 3, REALIZADO: 8, CANCELADO: 1 } })
  porStatus: Record<string, number>;
}

export class IndicadoresPlataformaDto {
  @ApiProperty({ type: ContagemPorStatusDto }) monitorias: ContagemPorStatusDto;
  @ApiProperty({ type: ContagemPorStatusDto }) atendimentos: ContagemPorStatusDto;

  @ApiProperty({
    example: 34,
    description: 'Alunos DISTINTOS com presenca confirmada em ao menos um atendimento.',
  })
  alunosAtendidos: number;

  @ApiProperty({ example: 12, description: 'Vinculos ativos com papel MONITOR.' })
  monitoresAtivos: number;

  @ApiProperty({ example: 58, description: 'Vinculos ativos com papel MONITORADO.' })
  monitoradosAtivos: number;

  @ApiProperty({ example: 41 }) totalAvaliacoes: number;

  @ApiPropertyOptional({ example: 4.5, nullable: true, description: 'Media geral das notas.' })
  mediaAvaliacoes: number | null;

  @ApiProperty({ example: 1240, description: 'Pontos distribuidos pela gamificacao.' })
  pontosDistribuidos: number;
}

export class IndicadoresMonitoriaDto {
  @ApiProperty({ format: 'uuid' }) monitoriaId: string;
  @ApiProperty({ example: 'MAT101 - Calculo I' }) disciplina: string;
  @ApiProperty({ example: '2026/2' }) periodo: string;
  @ApiProperty({ example: 'ATIVA' }) status: string;

  @ApiProperty({ type: ContagemPorStatusDto }) atendimentos: ContagemPorStatusDto;
  @ApiProperty({ example: 3 }) monitoresAtivos: number;
  @ApiProperty({ example: 24 }) monitoradosAtivos: number;

  @ApiProperty({ example: 19, description: 'Monitorados distintos que compareceram.' })
  alunosAtendidos: number;

  @ApiProperty({
    example: 0.79,
    description:
      'Alunos atendidos / monitorados ativos. 0 a 1. Mede quantos inscritos ' +
      'efetivamente usaram a monitoria.',
  })
  taxaParticipacao: number;

  @ApiProperty({ example: 6, description: 'Inscricoes marcadas como AUSENTE.' })
  ausencias: number;

  @ApiProperty({ example: 15 }) totalAvaliacoes: number;
  @ApiPropertyOptional({ example: 4.7, nullable: true }) mediaAvaliacoes: number | null;
  @ApiProperty({ example: 8 }) materiaisPublicados: number;
}

export class AtividadeMonitorDto {
  @ApiProperty({ format: 'uuid', description: 'ID do VINCULO do monitor na monitoria.' })
  participanteId: string;

  @ApiProperty({ format: 'uuid' }) usuarioId: string;
  @ApiProperty({ example: 'Ana Martins' }) nome: string;
  @ApiProperty({ example: 14 }) atendimentosRealizados: number;
  @ApiProperty({ example: 2 }) atendimentosCancelados: number;
  @ApiProperty({ example: 3 }) atendimentosAgendados: number;
  @ApiProperty({ example: 21, description: 'Presencas confirmadas nas sessoes dele.' })
  alunosAtendidos: number;

  /**
   * Carga horaria acumulada, em MINUTOS inteiros.
   *
   * Minutos sao a unidade canonica porque sao exatos: horas decimais nao
   * representam 1h20min sem dizima (1,3333...), e uma carga horaria que nao
   * fecha na conta do aluno e pior que uma unidade menos conveniente. O campo
   * em horas existe ao lado, para exibicao.
   *
   * Soma apenas atendimentos REALIZADOS — ver a nota no SQL de
   * `AnalyticsService.monitores`.
   */
  @ApiProperty({
    example: 1265,
    description:
      'Carga horaria acumulada em minutos, somando (fim - inicio) dos atendimentos ' +
      'REALIZADOS. AGENDADO e CANCELADO nao entram.',
  })
  cargaHorariaMinutos: number;

  @ApiProperty({
    example: 21.08,
    description: 'A mesma carga horaria em horas, com 2 casas. Derivado dos minutos.',
  })
  cargaHorariaHoras: number;

  @ApiProperty({ example: 11 }) totalAvaliacoes: number;
  @ApiPropertyOptional({ example: 4.8, nullable: true }) mediaAvaliacoes: number | null;
  @ApiProperty({ example: 6, description: 'Faixas de disponibilidade ativas.' })
  disponibilidadesAtivas: number;
}
