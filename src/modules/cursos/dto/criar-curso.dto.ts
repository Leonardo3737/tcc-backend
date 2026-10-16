import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/**
 * Somente o nome, como em CriarDisciplinaDto.
 *
 * O `codigo` e gerado pelo servidor a partir do nome (ENG001) e e imutavel:
 * disciplinas e alunos passam a referenciar o curso como identidade estavel.
 * Enviar `codigo` devolve 400 pelo `forbidNonWhitelisted`.
 */
export class CriarCursoDto {
  @ApiProperty({ example: 'Engenharia de Software' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'nome deve ser um texto' })
  @Length(2, 150, { message: 'nome deve ter entre 2 e 150 caracteres' })
  nome: string;
}
