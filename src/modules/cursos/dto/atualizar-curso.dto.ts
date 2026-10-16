import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/**
 * `codigo` nao e editavel, como em disciplinas: ele e a identidade estavel que
 * alunos e disciplinas ja referenciam. Renomear e permitido; reidentificar nao.
 *
 * Nao ha DELETE (RN10). Desativar e a forma de tirar um curso de circulacao
 * sem invalidar os alunos e as disciplinas ja vinculados a ele.
 */
export class AtualizarCursoDto {
  @ApiPropertyOptional({ example: 'Engenharia de Software (integral)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'nome deve ser um texto' })
  @Length(2, 150, { message: 'nome deve ter entre 2 e 150 caracteres' })
  nome?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Desativa o curso para novos vinculos, sem apagar historico.',
  })
  @IsOptional()
  @IsBoolean({ message: 'ativo deve ser booleano' })
  ativo?: boolean;
}
