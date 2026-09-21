import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** `matricula` nao e editavel: e dado de identidade institucional. */
export class AtualizarAlunoDto {
  @ApiPropertyOptional({ example: 'Engenharia de Software', nullable: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'curso deve ser um texto' })
  @MaxLength(120, { message: 'curso deve ter no maximo 120 caracteres' })
  curso?: string | null;
}
