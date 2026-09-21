import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginacaoDto } from '../../../common/dto/paginacao.dto';

export class FiltroDisciplinasDto extends PaginacaoDto {
  @ApiPropertyOptional({ description: 'Busca parcial por codigo ou nome.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'busca deve ser um texto' })
  @MaxLength(150, { message: 'busca deve ter no maximo 150 caracteres' })
  busca?: string;

  @ApiPropertyOptional({ description: 'Filtra por disciplinas ativas ou inativas.' })
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'ativa deve ser booleano' })
  ativa?: boolean;
}
