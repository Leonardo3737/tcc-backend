import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { CHAVE_ROTA_PUBLICA } from '../decorators/publico.decorator';

/**
 * Guard de autenticacao registrado globalmente (ver AuthModule).
 *
 * Padrao seguro por omissao: toda rota exige token valido, salvo as marcadas
 * com @Publico(). O frontend nunca decide se uma rota e protegida.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(contexto: ExecutionContext) {
    const ehPublica = this.reflector.getAllAndOverride<boolean>(CHAVE_ROTA_PUBLICA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (ehPublica) {
      return true;
    }

    return super.canActivate(contexto);
  }
}
