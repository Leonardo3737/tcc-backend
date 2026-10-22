import writeXlsxFile, { Cell, Row, SheetData } from 'write-excel-file/node';

/**
 * Montagem da planilha de inscricoes. Uma funcao, sem banco e sem rede.
 *
 * Separada do service pelo mesmo motivo de `mensagem-de-confirmacao.ts`: e a
 * parte que define o que a banca VE, e a unica que se pode conferir sem
 * PostgreSQL.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `write-excel-file` E NAO `exceljs`
 *
 * Os dois sao MIT e escrevem .xlsx de verdade. A diferenca e o peso: o exceljs
 * traz dez dependencias transitivas — entre elas `archiver`, `unzipper`, `tmp` e
 * `fast-csv` — para um projeto que precisa de UMA planilha de uma aba, sem
 * leitura, sem CSV e sem arquivo temporario. O `write-excel-file` traz uma
 * (`fflate`, de compressao) e cobre exatamente o necessario: celula tipada,
 * cabecalho em negrito, largura de coluna e linha fixa.
 *
 * Nao foi escrito a mao com o jszip que o projeto ja usa, embora .xlsx tambem
 * seja um pacote OOXML. O caso do .docx e diferente e vale a comparacao: la se
 * EDITA um arquivo valido existente, aqui seria CRIAR o formato do zero —
 * `sharedStrings`, `styles`, tipos de celula e referencias — e o erro tipico
 * (numero gravado como texto) nao quebra o arquivo, so faz a coluna "Media"
 * parar de somar na planilha de quem recebe.
 *
 * ---------------------------------------------------------------------------
 * NUMERO E NUMERO, E CELULA VAZIA NAO E ZERO
 *
 * As notas e a media saem como `type: Number`, nao como texto. A banca vai
 * ordenar, filtrar e somar essa coluna, e numero gravado como string se alinha a
 * esquerda e e ignorado por qualquer formula.
 *
 * Nota ausente vira celula VAZIA, nunca zero — a mesma regra que vale no banco
 * (`media` nula), na API e no relatorio. Em planilha o cuidado e ainda mais
 * concreto: `MEDIA()` sobre uma coluna com zeros devolve um numero menor e
 * plausivel, e ninguem percebe.
 */

/** Uma linha da planilha, com os campos ja resolvidos pela consulta. */
export interface LinhaDaPlanilha {
  email: string;
  nomeCompleto: string;
  matricula: string;
  curso: string;
  disciplina: string;
  professor: string;
  turno: string;
  n1: number | null;
  n2: number | null;
  media: number | null;
}

interface Coluna {
  titulo: string;
  largura: number;
  valor: (linha: LinhaDaPlanilha) => string | number | null;
  numerica?: boolean;
}

/**
 * As colunas, na ordem pedida.
 *
 * A ordem e a largura ficam juntas de proposito: largura e do conteudo da
 * coluna (e-mail institucional e longo, turno e curto), e separa-las em duas
 * listas faria uma desalinhar da outra na primeira coluna acrescentada.
 */
const COLUNAS: Coluna[] = [
  { titulo: 'E-mail do aluno', largura: 34, valor: (l) => l.email },
  { titulo: 'Nome do aluno', largura: 30, valor: (l) => l.nomeCompleto },
  { titulo: 'Matrícula do aluno', largura: 18, valor: (l) => l.matricula },
  { titulo: 'Curso', largura: 28, valor: (l) => l.curso },
  { titulo: 'Disciplina', largura: 28, valor: (l) => l.disciplina },
  { titulo: 'Nome do professor', largura: 28, valor: (l) => l.professor },
  { titulo: 'Turno', largura: 14, valor: (l) => l.turno },
  { titulo: 'Nota N1', largura: 10, valor: (l) => l.n1, numerica: true },
  { titulo: 'Nota N2', largura: 10, valor: (l) => l.n2, numerica: true },
  { titulo: 'Média', largura: 10, valor: (l) => l.media, numerica: true },
];

/** Duas casas decimais: as notas sao NUMERIC(4,2) e a media tambem. */
const FORMATO_DE_NOTA = '0.00';

export function colunasDaPlanilha(): string[] {
  return COLUNAS.map((coluna) => coluna.titulo);
}

export async function montarPlanilhaDeInscricoes(linhas: LinhaDaPlanilha[]): Promise<Buffer> {
  const cabecalho: Row = COLUNAS.map((coluna) => ({
    value: coluna.titulo,
    fontWeight: 'bold' as const,
  }));

  const corpo: Row[] = linhas.map((linha) =>
    COLUNAS.map((coluna): Cell => {
      const valor = coluna.valor(linha);

      if (coluna.numerica) {
        /**
         * `null` com `type: Number` produz celula VAZIA, nao zero. E o que
         * preserva "sem nota" como ausencia dentro da planilha.
         */
        return {
          value: valor === null ? undefined : Number(valor),
          type: Number,
          format: FORMATO_DE_NOTA,
        };
      }

      return { value: String(valor ?? ''), type: String };
    }),
  );

  /**
   * Anotado como `SheetData` de proposito: sem o tipo, o TypeScript escolhe a
   * sobrecarga de "lista de objetos" da biblioteca (que exige um `cell` por
   * coluna) e o erro aponta para um `columns` que esta correto.
   */
  const planilha: SheetData = [cabecalho, ...corpo];

  return writeXlsxFile(planilha, {
    sheet: 'Inscrições',
    /**
     * Cabecalho fixo: a banca rola centenas de candidatos, e sem isto perde de
     * vista qual coluna e qual exatamente quando passa a comparar notas.
     */
    stickyRowsCount: 1,
    columns: COLUNAS.map((coluna) => ({ width: coluna.largura })),
  }).toBuffer();
}
