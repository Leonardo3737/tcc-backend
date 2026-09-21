import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class RegistrarAlunoDto {
  @ApiProperty({ example: 'Joao da Silva' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'nome deve ser um texto' })
  @Length(3, 150, { message: 'nome deve ter entre 3 e 150 caracteres' })
  nome: string;

  @ApiProperty({ example: 'joao@ufx.edu.br' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email deve ser um endereco de e-mail valido' })
  @MaxLength(150, { message: 'email deve ter no maximo 150 caracteres' })
  email: string;

  @ApiProperty({ example: 'senhaSegura123', minLength: 8 })
  @IsString({ message: 'senha deve ser um texto' })
  @Length(8, 128, { message: 'senha deve ter entre 8 e 128 caracteres' })
  senha: string;

  @ApiProperty({ example: '2021001234' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'matricula deve ser um texto' })
  @Matches(/^[A-Za-z0-9._-]{3,30}$/, {
    message: 'matricula deve ter de 3 a 30 caracteres alfanumericos, ponto, hifen ou underscore',
  })
  matricula: string;

  @ApiPropertyOptional({ example: 'Ciencia da Computacao' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'curso deve ser um texto' })
  @MaxLength(120, { message: 'curso deve ter no maximo 120 caracteres' })
  curso?: string;
}
