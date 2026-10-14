import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

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
}
