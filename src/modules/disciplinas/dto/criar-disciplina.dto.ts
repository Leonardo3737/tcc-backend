import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, IsUUID, Length } from 'class-validator';

/**
 * Somente o nome.
 *
 * O `codigo` passou a ser gerado pelo servidor a partir do nome (CAL001), e por
 * isso saiu do DTO: era campo livre, com convencao diferente por professor e
 * colisao que so aparecia como 409 depois do formulario preenchido. Enviar
 * `codigo` hoje devolve 400 pelo `forbidNonWhitelisted`, o que e melhor que ser
 * ignorado em silencio.
 */
export class CriarDisciplinaDto {
  @ApiProperty({ example: 'Calculo I' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'nome deve ser um texto' })
  @Length(2, 150, { message: 'nome deve ter entre 2 e 150 caracteres' })
  nome: string;

  /**
   * Cursos que oferecem a disciplina. Pelo menos um.
   *
   * A mesma disciplina pode servir varios cursos — Banco de Dados e de Sistemas
   * de Informacao e de Engenharia da Computacao — e e esta lista que decide
   * quem podera participar das monitorias dela.
   *
   * Nao ha valor padrao de proposito: uma disciplina sem curso declarado
   * liberaria ou bloquearia todo mundo, e as duas respostas estariam erradas
   * por motivos diferentes.
   */
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1 })
  @IsArray({ message: 'cursosIds deve ser uma lista' })
  @ArrayMinSize(1, { message: 'informe ao menos um curso' })
  @ArrayMaxSize(20, { message: 'no maximo 20 cursos por disciplina' })
  @IsUUID('4', { each: true, message: 'cada item de cursosIds deve ser um UUID valido' })
  cursosIds: string[];
}
