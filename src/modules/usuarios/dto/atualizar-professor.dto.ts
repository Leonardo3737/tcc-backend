import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** `identificacaoFuncional` nao e editavel: e dado de identidade institucional. */
export class AtualizarProfessorDto {
  @ApiPropertyOptional({ example: 'Departamento de Matematica', nullable: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'departamento deve ser um texto' })
  @MaxLength(120, { message: 'departamento deve ter no maximo 120 caracteres' })
  departamento?: string | null;
}
