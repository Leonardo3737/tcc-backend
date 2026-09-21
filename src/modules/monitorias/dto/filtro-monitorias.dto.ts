import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import { PaginacaoDto } from '../../../common/dto/paginacao.dto';
import { StatusMonitoria } from '../../../common/enums/status-monitoria.enum';

export class FiltroMonitoriasDto extends PaginacaoDto {
  /**
   * Busca da tela "explorar monitorias".
   *
   * Sem ela o aluno precisa de dois passos — achar a disciplina em /disciplinas,
   * copiar o id, filtrar aqui — e buscar pelo nome do professor era impossivel.
   * Os joins de disciplina e professor ja existiam na consulta; a busca so
   * aproveita o que ja estava sendo carregado.
   */
  @ApiPropertyOptional({
    description: 'Busca parcial em codigo/nome da disciplina e no nome do professor.',
    example: 'calculo',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'busca deve ser um texto' })
  @MaxLength(150, { message: 'busca deve ter no maximo 150 caracteres' })
  busca?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'disciplinaId deve ser um UUID valido' })
  disciplinaId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'professorId deve ser um UUID valido' })
  professorId?: string;

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ano deve ser um numero inteiro' })
  @Min(2000, { message: 'ano deve ser no minimo 2000' })
  @Max(2100, { message: 'ano deve ser no maximo 2100' })
  ano?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'semestre deve ser um numero inteiro' })
  @Min(1, { message: 'semestre deve ser 1 ou 2' })
  @Max(2, { message: 'semestre deve ser 1 ou 2' })
  semestre?: number;

  @ApiPropertyOptional({ enum: StatusMonitoria })
  @IsOptional()
  @IsEnum(StatusMonitoria, { message: 'status invalido' })
  status?: StatusMonitoria;
}
