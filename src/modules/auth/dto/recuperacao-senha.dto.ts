import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export class SolicitarRecuperacaoDto {
  @ApiProperty({ example: 'ana.martins@ufx.edu.br' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email deve ser um endereco de e-mail valido' })
  @MaxLength(150, { message: 'email deve ter no maximo 150 caracteres' })
  email: string;
}

export class ConfirmarRecuperacaoDto {
  @ApiProperty({ example: 'ana.martins@ufx.edu.br' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email deve ser um endereco de e-mail valido' })
  @MaxLength(150, { message: 'email deve ter no maximo 150 caracteres' })
  email: string;

  /**
   * O formato e validado aqui, e nao no service, para que um corpo malformado
   * seja recusado ANTES de qualquer consulta ou verificacao de hash. Sem isso,
   * mandar um codigo de 4000 caracteres custaria um argon2 por requisicao.
   */
  @ApiProperty({ example: '483920', description: 'Codigo de 6 digitos recebido por e-mail.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'codigo deve ser um texto' })
  @Matches(/^\d{6}$/, { message: 'codigo deve ter exatamente 6 digitos' })
  codigo: string;

  @ApiProperty({ example: 'senhaNova456', minLength: 8 })
  @IsString({ message: 'novaSenha deve ser um texto' })
  @Length(8, 128, { message: 'novaSenha deve ter entre 8 e 128 caracteres' })
  novaSenha: string;
}
