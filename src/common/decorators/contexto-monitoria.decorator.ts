import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { ContextoParticipacao } from '../../modules/monitorias/participacao.service';

/**
 * Injeta o contexto ja resolvido pelo ParticipacaoGuard, evitando que o service
 * repita a mesma consulta que o guard acabou de fazer.
 */
export const ContextoMonitoria = createParamDecorator(
  (_dados: unknown, contexto: ExecutionContext): ContextoParticipacao => {
    return contexto.switchToHttp().getRequest().contextoParticipacao as ContextoParticipacao;
  },
);
