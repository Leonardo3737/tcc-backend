import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CriarAvaliacaoDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt({ message: 'nota deve ser um numero inteiro' })
  @Min(1, { message: 'nota deve estar entre 1 e 5' })
  @Max(5, { message: 'nota deve estar entre 1 e 5' })
  nota: number;

  @ApiPropertyOptional({ example: 'Explicou com clareza e paciencia.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'comentario deve ser um texto' })
  @Length(1, 2000, { message: 'comentario deve ter entre 1 e 2000 caracteres' })
  comentario?: string;
}
