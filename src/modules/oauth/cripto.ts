import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits aleatorios, em base64url: o formato de codigos e refresh tokens. */
export function gerarSegredo(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash deterministico, para guardar no banco e buscar por indice. */
export function sha256(valor: string): string {
  return createHash('sha256').update(valor).digest('hex');
}

/**
 * PKCE (RFC 7636, metodo S256): o cliente gerou um `code_verifier` secreto e
 * mandou so o SHA-256 dele (`code_challenge`) no /authorize. Agora, no /token,
 * ele prova que e o mesmo cliente revelando o verifier.
 */
export function pkceConfere(codeVerifier: string, codeChallenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) return false;
  const calculado = Buffer.from(createHash('sha256').update(codeVerifier).digest('base64url'));
  const esperado = Buffer.from(codeChallenge);
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}
