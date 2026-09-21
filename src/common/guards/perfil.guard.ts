import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CHAVE_PERFIS } from '../decorators/perfis.decorator';
import { PerfilUsuario } from '../enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../types/usuario-autenticado';

/**
 * Autorizacao por perfil de identidade (ALUNO / PROFESSOR).
 *
 * Roda depois do JwtAuthGuard, entao pode confiar que `request.user` existe
 * quando ha perfis exigidos. Um usuario com mais de um perfil (D-12) passa se
 * QUALQUER um dos seus perfis estiver na lista exigida.
 */
@Injectable()
export class PerfilGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const perfisExigidos = this.reflector.getAllAndOverride<PerfilUsuario[]>(CHAVE_PERFIS, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!perfisExigidos || perfisExigidos.length === 0) {
      return true;
    }

    const usuario = contexto.switchToHttp().getRequest().user as UsuarioAutenticado | undefined;

    if (!usuario || !perfisExigidos.some((perfil) => usuario.perfis.includes(perfil))) {
      throw new ForbiddenException(
        `Acesso restrito ao(s) perfil(is): ${perfisExigidos.join(', ')}.`,
      );
    }

    return true;
  }
}
