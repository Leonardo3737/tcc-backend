import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { ModalidadeAtendimento } from '../../../common/enums/modalidade-atendimento.enum';

/**
 * Operacao de dominio "agendar atendimento".
 *
 * Nao ha campos `status`, `origem` nem `criadoPor`: quem os define e o servidor,
 * a partir de quem esta autenticado e do papel que essa pessoa tem na monitoria.
 * Aceita-los do cliente permitiria criar um atendimento ja REALIZADO ou forjar a
 * autoria.
 */
export class AgendarAtendimentoDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Vinculo do MONITOR que vai atender. Obrigatorio quando quem agenda e o ' +
      'MONITORADO; ignorado quando o proprio monitor abre a sessao.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'monitorParticipanteId deve ser um UUID valido' })
  monitorParticipanteId?: string;

  @ApiProperty({ example: '2026-09-01T17:00:00.000Z', format: 'date-time' })
  @IsDateString({}, { message: 'inicio deve ser uma data ISO 8601 valida' })
  inicio: string;

  @ApiProperty({ example: '2026-09-01T18:00:00.000Z', format: 'date-time' })
  @IsDateString({}, { message: 'fim deve ser uma data ISO 8601 valida' })
  fim: string;

  @ApiProperty({ example: 'Duvidas sobre limites e continuidade' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'assunto deve ser um texto' })
  @Length(3, 200, { message: 'assunto deve ter entre 3 e 200 caracteres' })
  assunto: string;

  @ApiProperty({ enum: ModalidadeAtendimento })
  @IsEnum(ModalidadeAtendimento, { message: 'modalidade deve ser PRESENCIAL ou REMOTO' })
  modalidade: ModalidadeAtendimento;

  @ApiPropertyOptional({ example: 'Sala 203 / https://meet.exemplo/abc' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'local deve ser um texto' })
  @MaxLength(150, { message: 'local deve ter no maximo 150 caracteres' })
  local?: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    default: 1,
    description: 'Capacidade da sessao. 1 = atendimento individual.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'vagas deve ser um numero inteiro' })
  @Min(1, { message: 'vagas deve ser no minimo 1' })
  @Max(50, { message: 'vagas deve ser no maximo 50' })
  vagas?: number;
}
