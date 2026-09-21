import { PerfilUsuario } from '../enums/perfil-usuario.enum';

/**
 * Identidade do requisitante, montada pela JwtStrategy a cada requisicao
 * a partir do banco (nao apenas do payload do token).
 */
export interface UsuarioAutenticado {
  id: string;
  nome: string;
  email: string;
  perfis: PerfilUsuario[];
}
