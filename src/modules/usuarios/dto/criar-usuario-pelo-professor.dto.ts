import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * Campos comuns a criacao administrativa de qualquer usuario.
 *
 * Sao DTOs proprios, e nao os de /auth/registro, por um motivo de seguranca e
 * nao de organizacao: `RegistrarProfessorDto` aceita `codigoCadastro`, que aqui
 * nao faz sentido nenhum. Reusa-lo faria a API aceitar um campo que seria
 * silenciosamente ignorado — o mesmo defeito que corrigimos no `limite` de
 * /gamificacao/meus-pontos. Com DTO proprio, mandar `codigoCadastro` devolve
 * 400 pelo `forbidNonWhitelisted`.
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

  /**
   * Senha inicial, definida por quem cria a conta.
   *
   * O nome diz o que ela e: PROVISORIA. Quem cria a conta inevitavelmente conhece
   * a senha dela, entao o combinado e que a pessoa a troque no primeiro acesso,
   * em PATCH /api/usuarios/eu/senha. O backend ainda nao FORCA essa troca — ver
   * a nota sobre `deveTrocarSenha` no README.
   */
  @ApiProperty({
    example: 'provisoria2026',
    minLength: 8,
    description:
      'Senha inicial. Oriente a pessoa a troca-la no primeiro acesso via ' +
      'PATCH /api/usuarios/eu/senha — quem cria a conta conhece este valor.',
  })
  @IsString({ message: 'senhaProvisoria deve ser um texto' })
  @Length(8, 128, { message: 'senhaProvisoria deve ter entre 8 e 128 caracteres' })
  senhaProvisoria: string;
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
