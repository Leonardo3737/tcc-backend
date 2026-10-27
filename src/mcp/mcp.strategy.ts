import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';

// Exportado para que o controller abaixo use a MESMA instância do transporte.
export const mcpTransport = new StreamableHttpTransport();

export const mcp = new McpStrategy({
  name: 'monitoria',
  version: '1.0.0',
  transports: [mcpTransport],

  // Sem token, não entra. Precisa concordar com o JwtAuthGuard, que já rejeita.
  allowUnauthenticatedAccess: false,

  // O JwtStrategy grava { id, nome, email, perfis } em req.user.
  // O @ToolRoles da biblioteca lê "roles", então traduzimos perfis -> roles.
  resolveUser: (req: any) => {
    const usuario = req.user;
    return usuario ? { ...usuario, sub: usuario.id, roles: usuario.perfis } : undefined;
  },
})