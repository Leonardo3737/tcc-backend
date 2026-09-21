import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class AlterarSenhaDto {
  @ApiProperty({ example: 'senhaAntiga123' })
  @IsString({ message: 'senhaAtual deve ser um texto' })
  @IsNotEmpty({ message: 'senhaAtual nao pode ser vazia' })
  senhaAtual: string;

  @ApiProperty({ example: 'senhaNova456', minLength: 8 })
  @IsString({ message: 'novaSenha deve ser um texto' })
  @Length(8, 128, { message: 'novaSenha deve ter entre 8 e 128 caracteres' })
  novaSenha: string;
}
