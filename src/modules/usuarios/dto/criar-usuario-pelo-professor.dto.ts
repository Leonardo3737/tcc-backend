import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * Campos comuns a criacao de qualquer usuario.
 *
 * Com o auto-cadastro removido, estes sao os UNICOS DTOs de criacao de usuario
 * da API: nao existe mais um par em /auth/registro.
 *
 * NAO HA CAMPO DE SENHA, e isso e deliberado. Enquanto quem criava a conta
 * escolhia a senha, ela nascia conhecida por duas pessoas — e a que nao
 * escolheu nao tinha como saber se a outra a esqueceu. Agora o servidor gera
 * uma senha aleatoria e a entrega direto no e-mail da pessoa: quem cria a conta
 * nunca ve a credencial. Mandar `senhaProvisoria` hoje devolve 400 pelo
 * `forbidNonWhitelisted`, o que e melhor que ser ignorado em silencio.
 */
abstract class DadosBaseDoUsuario {
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
}

export class CriarAlunoPeloProfessorDto extends DadosBaseDoUsuario {
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

export class CriarProfessorPeloProfessorDto extends DadosBaseDoUsuario {
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
}
