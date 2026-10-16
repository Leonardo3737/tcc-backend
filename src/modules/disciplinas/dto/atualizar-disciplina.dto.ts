import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

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

  /**
   * SUBSTITUI o conjunto de cursos, nao acrescenta.
   *
   * Remover um curso e recusado pelo banco enquanto houver participante dele na
   * disciplina: a FK composta de `monitoria_participantes` aponta para esta
   * associacao, e apagar a linha deixaria vinculos orfaos de regra. Omitir o
   * campo nao mexe nos cursos.
   */
  @ApiPropertyOptional({ type: [String], format: 'uuid', minItems: 1 })
  @IsOptional()
  @IsArray({ message: 'cursosIds deve ser uma lista' })
  @ArrayMinSize(1, { message: 'a disciplina precisa de ao menos um curso' })
  @ArrayMaxSize(20, { message: 'no maximo 20 cursos por disciplina' })
  @IsUUID('4', { each: true, message: 'cada item de cursosIds deve ser um UUID valido' })
  cursosIds?: string[];
}
