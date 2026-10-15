import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { ModalidadeAtendimento } from '../../../common/enums/modalidade-atendimento.enum';

export class OcorrenciaDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-21T18:00:00.000Z' })
  @IsISO8601({}, { message: 'inicio deve estar no formato ISO 8601' })
  inicio: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T19:00:00.000Z' })
  @IsISO8601({}, { message: 'fim deve estar no formato ISO 8601' })
  fim: string;
}

/**
 * Campos que todas as sessoes da serie compartilham.
 *
 * Deliberadamente iguais aos de `AgendarAtendimentoDto` menos o horario: uma
 * serie e a mesma sessao repetida em datas diferentes. Se a serie precisasse de
 * assunto ou monitor distintos por ocorrencia, seriam sessoes independentes —
 * e o endpoint unitario ja resolve isso.
 */
export class AgendarAtendimentosEmLoteDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Monitor da serie. Ignorado quando quem agenda e o proprio monitor.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'monitorParticipanteId deve ser um UUID valido' })
  monitorParticipanteId?: string;

  @ApiProperty({ example: 'Plantao semanal de duvidas' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'assunto deve ser um texto' })
  @Length(3, 200, { message: 'assunto deve ter entre 3 e 200 caracteres' })
  assunto: string;

  @ApiProperty({ enum: ModalidadeAtendimento })
  @IsEnum(ModalidadeAtendimento, { message: 'modalidade deve ser PRESENCIAL ou REMOTO' })
  modalidade: ModalidadeAtendimento;

  @ApiPropertyOptional({ example: 'Sala 203' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'local deve ser um texto' })
  @MaxLength(150, { message: 'local deve ter no maximo 150 caracteres' })
  local?: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'vagas deve ser um numero inteiro' })
  @Min(1, { message: 'vagas deve ser no minimo 1' })
  @Max(50, { message: 'vagas deve ser no maximo 50' })
  vagas?: number;

  /**
   * Teto de 30 por requisicao.
   *
   * Nao e limite arbitrario: cada ocorrencia abre a propria transacao e valida
   * disponibilidade com uma ida ao banco. Trinta cobre um semestre inteiro de
   * encontro semanal e mantem a requisicao com duracao previsivel.
   */
  @ApiProperty({ type: [OcorrenciaDto], minItems: 1, maxItems: 30 })
  @IsArray({ message: 'ocorrencias deve ser uma lista' })
  @ArrayMinSize(1, { message: 'informe ao menos uma ocorrencia' })
  @ArrayMaxSize(30, { message: 'no maximo 30 ocorrencias por requisicao' })
  @ValidateNested({ each: true })
  @Type(() => OcorrenciaDto)
  ocorrencias: OcorrenciaDto[];
}
