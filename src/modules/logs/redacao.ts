/**
 * Remocao de dados sensiveis antes de gravar qualquer coisa no log.
 *
 * Este arquivo e a parte mais importante do modulo, e o motivo e direto: gravar
 * corpo de requisicao sem filtrar colocaria em texto claro, numa tabela que
 * qualquer SELECT alcanca, exatamente aquilo que o resto do projeto se esforcou
 * para proteger — a senha que o argon2 existe para nunca armazenar, o codigo de
 * recuperacao que so vive como hash, e o token que da acesso a conta.
 *
 * A regra e por NOME DE CAMPO, em qualquer profundidade, e a lista e fechada:
 * campo desconhecido passa. A alternativa (lista do que pode passar) seria mais
 * segura, mas tornaria o log inutil — todo campo novo nasceria censurado e
 * ninguem perceberia ate precisar dele.
 *
 * Funcoes puras, testadas isoladamente: e a unica forma de afirmar com seguranca
 * que um campo novo e coberto.
 */

export const MARCA = '[REDACTED]';

/**
 * Nomes considerados sensiveis, comparados em minusculas.
 *
 * Inclui variacoes porque a API realmente usa varios nomes para a mesma coisa:
 * `senha` no login, `senhaAtual`/`novaSenha` na troca, `senhaProvisoria` na
 * criacao pelo professor. `codigo` cobre a recuperacao de senha — e vale notar
 * que isso tambem censura o codigo da disciplina, um falso positivo que e
 * preferivel ao inverso.
 */
const CAMPOS_SENSIVEIS = new Set([
  'senha',
  'senhaatual',
  'novasenha',
  'senhaprovisoria',
  'senhahash',
  'codigo',
  'codigocadastro',
  'token',
  'tokendeacesso',
  'refreshtoken',
  'authorization',
  'apikey',
  'api-key',
  'brevo_api_key',
  'secret',
  'jwt_secret',
]);

/** Teto por campo de texto: evita que um corpo grande inche a tabela. */
const LIMITE_DE_TEXTO = 2_000;

function ehSensivel(chave: string): boolean {
  return CAMPOS_SENSIVEIS.has(chave.toLowerCase());
}

/**
 * Percorre o valor recursivamente, substituindo campos sensiveis pela marca.
 *
 * Objetos e arrays sao percorridos; o restante e devolvido como esta. A
 * profundidade e limitada porque um corpo malformado — ou malicioso — poderia
 * trazer uma estrutura circular ou profunda demais e derrubar o processo em uma
 * operacao que e mero registro.
 */
export function redigir(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 6) {
    return '[profundo demais]';
  }

  if (Array.isArray(valor)) {
    return valor.map((item) => redigir(item, profundidade + 1));
  }

  if (valor instanceof Date) {
    return valor.toISOString();
  }

  if (valor !== null && typeof valor === 'object') {
    const saida: Record<string, unknown> = {};

    for (const [chave, conteudo] of Object.entries(valor as Record<string, unknown>)) {
      saida[chave] = ehSensivel(chave) ? MARCA : redigir(conteudo, profundidade + 1);
    }

    return saida;
  }

  if (typeof valor === 'string' && valor.length > LIMITE_DE_TEXTO) {
    return `${valor.slice(0, LIMITE_DE_TEXTO)}... [truncado]`;
  }

  return valor;
}

/**
 * Serializa para gravar, ja redigido e com teto de tamanho.
 *
 * Devolve `null` para vazio, para nao encher a tabela de `{}` e `""`. Nunca
 * lanca: um corpo que nao serializa vira um aviso, porque registrar log jamais
 * pode ser o motivo de uma requisicao falhar.
 */
export function paraRegistro(valor: unknown, limite = 8_000): string | null {
  if (valor === undefined || valor === null) {
    return null;
  }

  try {
    const texto = JSON.stringify(redigir(valor));

    if (!texto || texto === '{}' || texto === '""' || texto === '[]') {
      return null;
    }

    return texto.length > limite ? `${texto.slice(0, limite)}... [truncado]` : texto;
  } catch {
    return '[nao serializavel]';
  }
}
