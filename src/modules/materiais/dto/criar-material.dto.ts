import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';

export class CriarMaterialDto {
  @ApiProperty({ example: 'Lista de exercicios - Limites' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'titulo deve ser um texto' })
  @Length(3, 150, { message: 'titulo deve ter entre 3 e 150 caracteres' })
  titulo: string;

  @ApiPropertyOptional({ example: 'Exercicios 1 a 20 do capitulo 2.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'descricao deve ser um texto' })
  @MaxLength(2000, { message: 'descricao deve ter no maximo 2000 caracteres' })
  descricao?: string;

  /**
   * Apenas http/https.
   *
   * Sem essa restricao, um `javascript:` ou `data:` publicado aqui viraria XSS
   * assim que o frontend renderizasse o link.
   */
  @ApiProperty({ example: 'https://drive.exemplo.com/lista-limites.pdf' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'url deve ser um endereco http ou https valido' },
  )
  @MaxLength(2048, { message: 'url deve ter no maximo 2048 caracteres' })
  url: string;
}
