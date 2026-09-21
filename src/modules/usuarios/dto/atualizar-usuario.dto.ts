import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * Somente `nome` e editavel pelo proprio usuario.
 *
 * `email` fica de fora porque e a credencial de login (trocar exige fluxo de
 * confirmacao, fora do escopo da fase 1) e `ativo` fica de fora porque nao
 * existe ator com poder para isso enquanto nao houver perfil administrativo.
 */
export class AtualizarUsuarioDto {
  @ApiPropertyOptional({ example: 'Joao da Silva Junior' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'nome deve ser um texto' })
  @Length(3, 150, { message: 'nome deve ter entre 3 e 150 caracteres' })
  nome?: string;
}
