import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';

export class AtualizarMaterialDto {
  @ApiPropertyOptional({ example: 'Lista de exercicios - Limites (revisada)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'titulo deve ser um texto' })
  @Length(3, 150, { message: 'titulo deve ter entre 3 e 150 caracteres' })
  titulo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'descricao deve ser um texto' })
  @MaxLength(2000, { message: 'descricao deve ter no maximo 2000 caracteres' })
  descricao?: string;

  @ApiPropertyOptional({ example: 'https://drive.exemplo.com/v2.pdf' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'url deve ser um endereco http ou https valido' },
  )
  @MaxLength(2048, { message: 'url deve ter no maximo 2048 caracteres' })
  url?: string;
}
