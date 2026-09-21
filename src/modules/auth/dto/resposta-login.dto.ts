import { ApiProperty } from '@nestjs/swagger';

import { UsuarioRespostaDto } from '../../usuarios/dto/usuario-resposta.dto';

export class RespostaLoginDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  tokenDeAcesso: string;

  @ApiProperty({ example: 'Bearer' })
  tipoToken: string;

  /**
   * Mantido por compatibilidade: e a string de configuracao (JWT_EXPIRES_IN),
   * legivel para humanos mas inutil para calculo. Prefira os dois campos abaixo,
   * que sao derivados do claim `exp` do token EFETIVAMENTE assinado — nao de uma
   * reinterpretacao da configuracao.
   */
  @ApiProperty({
    example: '1h',
    description: 'Tempo de vida configurado, em formato humano. Use expiraEmSegundos para calculo.',
    deprecated: true,
  })
  expiraEm: string;

  @ApiProperty({
    example: 3600,
    description:
      'Segundos ate a expiracao, contados a partir da emissao. Derivado do claim exp. ' +
      'Adequado para o maxAge de um cookie de sessao.',
  })
  expiraEmSegundos: number;

  @ApiProperty({
    example: '2026-09-08T13:00:00.000Z',
    format: 'date-time',
    description: 'Instante absoluto de expiracao (UTC), derivado do claim exp.',
  })
  expiraEmIso: string;

  @ApiProperty({ type: UsuarioRespostaDto })
  usuario: UsuarioRespostaDto;
}

/**
 * Conteudo do JWT.
 *
 * `perfis` viaja no token apenas para conveniencia do frontend (decidir o que
 * renderizar). A autorizacao do backend NAO confia nesse campo: a JwtStrategy
 * recarrega os perfis do banco a cada requisicao.
 */
export interface PayloadJwt {
  sub: string;
  email: string;
  perfis: string[];
}
