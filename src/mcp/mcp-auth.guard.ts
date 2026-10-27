import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';

import { OAuthService } from '../modules/oauth/oauth.service';

/**
 * Autenticacao do endpoint MCP.
 *
 * Valida o token com a MESMA JwtStrategy da API. A unica diferenca para o
 * JwtAuthGuard global e o que acontece quando falha: alem do 401, envia o
 * cabecalho WWW-Authenticate apontando para os metadados OAuth. E esse
 * cabecalho que faz o Claude abrir a tela de login.
 */
@Injectable()
export class McpAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly oauthService: OAuthService) {
    super();
  }

  override async canActivate(contexto: ExecutionContext): Promise<boolean> {
    try {
      return (await super.canActivate(contexto)) as boolean;
    } catch (erro) {
      if (erro instanceof UnauthorizedException) {
        contexto
          .switchToHttp()
          .getResponse<Response>()
          .setHeader(
            'WWW-Authenticate',
            `Bearer resource_metadata="${this.oauthService.urlMetadataDoRecurso}", scope="mcp"`,
          );
      }
      throw erro;
    }
  }
}
