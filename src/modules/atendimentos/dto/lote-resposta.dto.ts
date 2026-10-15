import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Resultado de UMA ocorrencia da serie.
 *
 * A lista preserva a ordem de entrada para que o cliente consiga casar cada
 * resultado com a linha que o usuario digitou, sem depender de comparar datas.
 */
export class ResultadoDeOcorrenciaDto {
  @ApiProperty({ format: 'date-time' })
  inicio: string;

  @ApiProperty({ format: 'date-time' })
  fim: string;

  @ApiProperty({ example: true })
  criado: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'Presente apenas quando `criado` e true.' })
  atendimentoId?: string;

  @ApiPropertyOptional({
    example: 'Este monitor ja possui outro atendimento que se sobrepoe a este horario (RN03).',
    description: 'Motivo de dominio da recusa. Presente apenas quando `criado` e false.',
  })
  erro?: string;
}

/**
 * Resposta do lote. 200, nunca 201.
 *
 * A criacao e parcial por natureza: um feriado no meio da serie recusa uma
 * ocorrencia e cria as demais. `201 Created` afirmaria que tudo foi criado, o
 * que seria falso justamente no caso que motiva o endpoint.
 */
export class LoteDeAtendimentosRespostaDto {
  @ApiProperty({ example: 12 })
  criados: number;

  @ApiProperty({ example: 1 })
  recusados: number;

  @ApiProperty({ type: [ResultadoDeOcorrenciaDto] })
  resultados: ResultadoDeOcorrenciaDto[];
}
