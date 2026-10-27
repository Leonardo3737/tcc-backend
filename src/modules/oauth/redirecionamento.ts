/**
 * Regras para as URIs de retorno (redirect_uri).
 *
 * - O Claude web, desktop e mobile usam https://claude.ai/api/mcp/auth_callback.
 * - O Claude Code e o MCP Inspector rodam na maquina do usuario e usam
 *   "loopback": http://localhost:<porta>/... ou http://127.0.0.1:<porta>/...,
 *   com uma porta diferente a cada sessao (RFC 8252). Por isso, para loopback,
 *   a porta e ignorada na comparacao.
 * - Qualquer outro http:// e recusado: o codigo de autorizacao viajaria sem TLS.
 */
const HOSTS_LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function analisar(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

function ehLoopback(url: URL): boolean {
  return url.protocol === 'http:' && HOSTS_LOOPBACK.has(url.hostname);
}

/** Usada no registro do cliente. */
export function redirectUriAceitavel(uri: string): boolean {
  const url = analisar(uri);
  if (!url || url.hash) return false;
  return url.protocol === 'https:' || ehLoopback(url);
}

/** Usada no /authorize: a URI pedida precisa bater com uma das registradas. */
export function redirectUriRegistrada(pedida: string, registradas: string[]): boolean {
  const urlPedida = analisar(pedida);
  if (!urlPedida) return false;

  return registradas.some((registrada) => {
    if (registrada === pedida) return true;

    const urlRegistrada = analisar(registrada);
    if (!urlRegistrada || !ehLoopback(urlPedida) || !ehLoopback(urlRegistrada)) return false;

    // Loopback: compara tudo, menos a porta.
    return (
      urlPedida.hostname === urlRegistrada.hostname &&
      urlPedida.pathname === urlRegistrada.pathname &&
      urlPedida.search === urlRegistrada.search
    );
  });
}

/** Acrescenta parametros a uma URI de retorno sem perder os que ela ja tem. */
export function montarRedirecionamento(base: string, parametros: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor !== undefined) url.searchParams.set(chave, valor);
  }
  return url.toString();
}
