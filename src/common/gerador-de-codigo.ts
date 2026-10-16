/**
 * Geracao de codigo legivel para catalogos (disciplina e curso).
 *
 * Mora em `common/` porque serve mais de um modulo: disciplina e curso tem a
 * mesma forma — nome livre, codigo gerado, imutavel — e duplicar a regra faria
 * as duas divergirem na primeira correcao de normalizacao.
 *
 * O codigo deixou de ser digitado por quem cadastra: era campo livre, sujeito a
 * convencoes diferentes por professor ("MAT101", "mat-101", "CALCULO1") e a
 * colisoes que so apareciam como 409 depois de preencher o formulario.
 *
 * O formato e PREFIXO + SEQUENCIA: "Calculo I" vira CAL001, e a proxima
 * disciplina cujo prefixo tambem seja CAL vira CAL002. A intencao e que o
 * codigo continue dizendo alguma coisa — a busca de `?busca=` procura em codigo
 * e nome, e um identificador opaco tornaria metade dessa busca inutil.
 *
 * Funcoes puras, separadas do service, porque sao a parte com regra de verdade
 * (normalizacao de acentos, prefixo curto demais, numeracao) e merecem teste
 * direto.
 */

/** Tamanho do prefixo e largura minima do numero: CAL001. */
const TAMANHO_DO_PREFIXO = 3;
const DIGITOS_MINIMOS = 3;

/** Usado quando o nome nao tem nenhuma letra aproveitavel (ex.: "101"). */
const PREFIXO_PADRAO = 'DIS';

/**
 * Deriva o prefixo do nome da disciplina.
 *
 * A normalizacao NFD separa a letra do acento, e a faixa combinante e removida:
 * "Algebra" e "Álgebra" produzem o mesmo ALG. Sem isso, o mesmo nome digitado
 * com e sem acento geraria prefixos diferentes.
 *
 * Nomes curtos sao completados com X ("IA" -> IAX) em vez de gerar prefixo de
 * tamanho variavel: codigo de largura fixa e mais facil de ler em lista e de
 * alinhar em tabela.
 */
export function prefixoDoNome(nome: string): string {
  const letras = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

  if (letras.length === 0) {
    return PREFIXO_PADRAO;
  }

  return letras.slice(0, TAMANHO_DO_PREFIXO).padEnd(TAMANHO_DO_PREFIXO, 'X');
}

/**
 * Proximo codigo livre, dado o prefixo e os codigos que ja existem com ele.
 *
 * Considera apenas codigos no formato PREFIXO + digitos. Codigos legados de
 * formato livre ("CALCULO-1"), cadastrados quando o campo era digitado, nao
 * entram na numeracao — mas continuam valendo como codigo, e a constraint
 * UNIQUE segue sendo quem garante que nao havera repeticao.
 *
 * A LARGURA do numero acompanha a maior ja usada no prefixo, com minimo de 3.
 * Uma base que ja tinha FIS0110 recebe FIS0111, e nao FIS111: os dois seriam
 * unicos, mas uma familia com larguras misturadas e exatamente o que o formato
 * legivel veio evitar. Pelo mesmo mecanismo, passar de 999 nao quebra nem
 * reinicia — o numero apenas ocupa mais um digito (CAL1000).
 */
export function proximoCodigo(prefixo: string, codigosExistentes: string[]): string {
  const padrao = new RegExp(`^${prefixo}(\\d+)$`, 'i');

  const numeros = codigosExistentes
    .map((codigo) => padrao.exec(codigo)?.[1])
    .filter((digitos): digitos is string => digitos !== undefined);

  const maior = numeros.reduce((maximo, digitos) => Math.max(maximo, Number(digitos)), 0);

  const largura = numeros.reduce(
    (maxima, digitos) => Math.max(maxima, digitos.length),
    DIGITOS_MINIMOS,
  );

  return `${prefixo}${String(maior + 1).padStart(largura, '0')}`;
}
