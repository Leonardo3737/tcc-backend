import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/**
 * `codigo` nao e editavel: monitorias e materiais ja publicados o referenciam
 * como identidade estavel da disciplina. Renomear e permitido; reidentificar nao.
 */
export class AtualizarDisciplinaDto {
  @ApiPropertyOptional({ example: 'Calculo Diferencial e Integral I' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'nome deve ser um texto' })
  @Length(2, 150, { message: 'nome deve ter entre 2 e 150 caracteres' })
  nome?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Desativa a disciplina para novas monitorias, sem apagar historico.',
  })
  @IsOptional()
  @IsBoolean({ message: 'ativa deve ser booleano' })
  ativa?: boolean;
}
