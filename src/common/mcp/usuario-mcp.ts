import { UnauthorizedException } from '@nestjs/common';
import { McpContext } from '@rekog/mcp-nest';

import { UsuarioAutenticado } from '../types/usuario-autenticado';

/** O usuário vem SEMPRE do token, nunca dos argumentos da ferramenta. */
export function usuarioMcp(ctx: McpContext): UsuarioAutenticado {
  const usuario = ctx.getUser() as UsuarioAutenticado | undefined;
  if (!usuario) {
    throw new UnauthorizedException('Sessao invalida. Faca login novamente.');
  }
  return { id: usuario.id, nome: usuario.nome, email: usuario.email, perfis: usuario.perfis };
}