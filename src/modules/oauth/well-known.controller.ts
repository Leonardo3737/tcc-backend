import { Controller, Get } from '@nestjs/common';

import { Publico } from '../../common/decorators/publico.decorator';
import { OAuthService } from './oauth.service';

/**
 * Documentos de descoberta. Ficam na RAIZ do dominio (fora do prefixo /api),
 * porque e la que as RFCs mandam o cliente procurar. Ver o `exclude` do
 * setGlobalPrefix no main.ts.
 */
@Publico()
@Controller('.well-known')
export class WellKnownController {
  constructor(private readonly oauthService: OAuthService) {}

  /** RFC 9728: "o MCP e protegido por este servidor de autorizacao". */
  @Get('oauth-protected-resource')
  recurso() {
    return this.oauthService.metadataDoRecurso();
  }

  /** RFC 8414: endpoints e capacidades do servidor de autorizacao. */
  @Get('oauth-authorization-server')
  servidor() {
    return this.oauthService.metadataDoServidor();
  }
}
