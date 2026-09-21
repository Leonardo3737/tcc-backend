import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CriarMonitoriaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'disciplinaId deve ser um UUID valido' })
  disciplinaId: string;

  @ApiProperty({ example: 2026, minimum: 2000, maximum: 2100 })
  @Type(() => Number)
  @IsInt({ message: 'ano deve ser um numero inteiro' })
  @Min(2000, { message: 'ano deve ser no minimo 2000' })
  @Max(2100, { message: 'ano deve ser no maximo 2100' })
  ano: number;

  @ApiProperty({ example: 2, enum: [1, 2] })
  @Type(() => Number)
  @IsInt({ message: 'semestre deve ser um numero inteiro' })
  @Min(1, { message: 'semestre deve ser 1 ou 2' })
  @Max(2, { message: 'semestre deve ser 1 ou 2' })
  semestre: number;

  @ApiPropertyOptional({ example: 'Monitoria de apoio para listas e provas.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'descricao deve ser um texto' })
  @MaxLength(2000, { message: 'descricao deve ter no maximo 2000 caracteres' })
  descricao?: string;

  @ApiPropertyOptional({ example: '2026-08-01', format: 'date' })
  @IsOptional()
  @IsDateString({}, { message: 'dataInicio deve estar no formato AAAA-MM-DD' })
  dataInicio?: string;

  @ApiPropertyOptional({ example: '2026-12-15', format: 'date' })
  @IsOptional()
  @IsDateString({}, { message: 'dataFim deve estar no formato AAAA-MM-DD' })
  dataFim?: string;
}
