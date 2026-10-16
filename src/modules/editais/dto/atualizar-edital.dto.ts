import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PADRAO_DATA } from './criar-edital.dto';

/**
 * Tudo editavel, inclusive as datas e o periodo academico.
 *
 * Um edital nao tem identidade derivada de campo nenhum (nao ha codigo gerado,
 * como em curso e disciplina), e corrigir uma data digitada errada e operacao
 * legitima. O que o banco nao deixa e deixar o periodo invertido: a CHECK
 * `ck_edital_periodo` vale para UPDATE tambem, entao alterar so uma das datas
 * para um valor incoerente e recusado — por isso o service le as duas e valida
 * o par resultante antes de gravar.
 *
 * `ativo` aqui e o caminho de REATIVACAO. A desativacao tem rota propria
 * (`DELETE /editais/:id`), que e a exclusao pedida no escopo: logica, nunca
 * fisica (RN10).
 */
export class AtualizarEditalDto {
  @ApiPropertyOptional({ example: '2026-11-10', format: 'date' })
  @IsOptional()
  @Matches(PADRAO_DATA, { message: 'inicioInscricoes deve estar no formato AAAA-MM-DD' })
  @IsDateString({ strict: true }, { message: 'inicioInscricoes nao e uma data valida' })
  inicioInscricoes?: string;

  @ApiPropertyOptional({ example: '2026-11-30', format: 'date' })
  @IsOptional()
  @Matches(PADRAO_DATA, { message: 'fimInscricoes deve estar no formato AAAA-MM-DD' })
  @IsDateString({ strict: true }, { message: 'fimInscricoes nao e uma data valida' })
  fimInscricoes?: string;

  @ApiPropertyOptional({ example: 'https://ufx.edu.br/editais/2026-2-monitoria-retificado.pdf' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(2048, { message: 'link deve ter no maximo 2048 caracteres' })
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: 'link deve ser uma URL http ou https completa' },
  )
  link?: string;

  @ApiPropertyOptional({ example: 2026, minimum: 2000, maximum: 2100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ano deve ser um numero inteiro' })
  @Min(2000, { message: 'ano deve ser no minimo 2000' })
  @Max(2100, { message: 'ano deve ser no maximo 2100' })
  ano?: number;

  @ApiPropertyOptional({ example: 2, enum: [1, 2] })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'semestre deve ser um numero inteiro' })
  @Min(1, { message: 'semestre deve ser 1 ou 2' })
  @Max(2, { message: 'semestre deve ser 1 ou 2' })
  semestre?: number;

  @ApiPropertyOptional({
    example: true,
    description:
      'Reativa um edital excluido logicamente. A exclusao em si e feita por DELETE /editais/:id.',
  })
  @IsOptional()
  @IsBoolean({ message: 'ativo deve ser booleano' })
  ativo?: boolean;
}
