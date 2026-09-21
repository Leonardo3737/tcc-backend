import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class RegistrarProfessorDto {
  @ApiProperty({ example: 'Maria Souza' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'nome deve ser um texto' })
  @Length(3, 150, { message: 'nome deve ter entre 3 e 150 caracteres' })
  nome: string;

  @ApiProperty({ example: 'maria@ufx.edu.br' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email deve ser um endereco de e-mail valido' })
  @MaxLength(150, { message: 'email deve ter no maximo 150 caracteres' })
  email: string;

  @ApiProperty({ example: 'senhaSegura123', minLength: 8 })
  @IsString({ message: 'senha deve ser um texto' })
  @Length(8, 128, { message: 'senha deve ter entre 8 e 128 caracteres' })
  senha: string;

  @ApiPropertyOptional({ example: '1234567', description: 'SIAPE ou matricula funcional.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'identificacaoFuncional deve ser um texto' })
  @Matches(/^[A-Za-z0-9._-]{3,30}$/, {
    message: 'identificacaoFuncional deve ter de 3 a 30 caracteres alfanumericos',
  })
  identificacaoFuncional?: string;

  @ApiPropertyOptional({ example: 'Departamento de Computacao' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'departamento deve ser um texto' })
  @MaxLength(120, { message: 'departamento deve ter no maximo 120 caracteres' })
  departamento?: string;

  @ApiPropertyOptional({
    description:
      'Codigo de cadastro de professor. Obrigatorio quando CODIGO_CADASTRO_PROFESSOR ' +
      'esta configurado no servidor.',
  })
  @IsOptional()
  @IsString({ message: 'codigoCadastro deve ser um texto' })
  codigoCadastro?: string;
}
