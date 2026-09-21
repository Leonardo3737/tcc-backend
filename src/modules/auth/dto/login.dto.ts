import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'joao@ufx.edu.br' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email deve ser um endereco de e-mail valido' })
  email: string;

  @ApiProperty({ example: 'senhaSegura123' })
  @IsString({ message: 'senha deve ser um texto' })
  @IsNotEmpty({ message: 'senha nao pode ser vazia' })
  senha: string;
}
