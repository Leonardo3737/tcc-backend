import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { UsuarioAutenticado } from '../types/usuario-autenticado';

/**
 * Injeta o usuario autenticado no handler.
 *
 * Existe para que nenhum controller precise ler `request.user` na mao — e,
 * principalmente, para que o ID do requisitante venha SEMPRE do token e nunca
 * do corpo ou da query string, onde o cliente poderia forjar outro usuario.
 */
export const UsuarioAtual = createParamDecorator(
  (_dados: unknown, contexto: ExecutionContext): UsuarioAutenticado => {
    return contexto.switchToHttp().getRequest().user as UsuarioAutenticado;
  },
);
