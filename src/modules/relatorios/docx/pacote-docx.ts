import JSZip from 'jszip';

/**
 * Leitura e regravacao do pacote .docx. A unica parte que conhece ZIP.
 *
 * Um .docx e um ZIP com XMLs dentro. Preencher o modelo, portanto, e: abrir o
 * pacote, trocar o conteudo de UM arquivo (`word/document.xml`) e fechar. Todo
 * o resto — cabecalho com logotipo, estilos, fontes, tema, numeracao, as
 * relacoes entre as partes — volta BYTE A BYTE como estava.
 *
 * E essa a razao de a geracao preservar a identidade visual do documento
 * oficial sem que nenhuma linha de codigo descreva margem, borda ou fonte:
 * nada disso e reconstruido, apenas devolvido.
 *
 * `jszip` foi escolhida por ser a biblioteca de ZIP mais estabelecida do
 * ecossistema Node, com tipos proprios (sem `@types/*` extra), licenca MIT e
 * sem dependencia nativa — importa para um projeto que roda em Windows e em
 * container Linux sem passo de compilacao.
 */
export const CAMINHO_DO_DOCUMENTO = 'word/document.xml';

/**
 * Nivel de compressao do pacote regravado.
 *
 * O padrao do jszip e STORE (sem compressao), e isso produziria um .docx
 * valido, mas varias vezes maior que o modelo — o Word e o LibreOffice abrem,
 * porem o arquivo que o monitor baixa e anexa em e-mail nao deveria inflar sem
 * motivo. DEFLATE nivel 6 e o que o proprio Word usa.
 */
const COMPRESSAO = {
  type: 'nodebuffer' as const,
  compression: 'DEFLATE' as const,
  compressionOptions: { level: 6 },
};

export class PacoteDocxInvalido extends Error {}

/**
 * Abre o pacote e devolve o XML do documento junto do pacote aberto.
 *
 * O pacote volta para quem chamou porque gravar exige o MESMO objeto: criar um
 * zip novo e copiar as entradas perderia metadados de cada arquivo e e trabalho
 * sem ganho.
 */
export async function abrirDocx(
  conteudo: Buffer,
): Promise<{ pacote: JSZip; documentoXml: string }> {
  let pacote: JSZip;

  try {
    /**
     * `createFolders: false` para o pacote regravado ficar com as MESMAS
     * entradas do modelo. O padrao do jszip inventa uma entrada de diretorio
     * (`word/`) que o modelo nao tem; Word e LibreOffice ignoram, mas um pacote
     * que difere do original em algo que nao foi alterado de proposito e um
     * detalhe a menos para investigar se um dia algum leitor reclamar.
     */
    pacote = await JSZip.loadAsync(conteudo, { createFolders: false });
  } catch (erro) {
    throw new PacoteDocxInvalido(
      `O modelo nao e um pacote .docx legivel: ${erro instanceof Error ? erro.message : erro}`,
    );
  }

  const documento = pacote.file(CAMINHO_DO_DOCUMENTO);

  if (!documento) {
    /**
     * ZIP valido sem `word/document.xml` nao e um .docx. Acusar aqui, com o
     * caminho que faltou, evita que o erro apareca mais tarde como "undefined
     * nao tem .indexOf" em cima de uma string que nunca existiu.
     */
    throw new PacoteDocxInvalido(
      `O pacote nao contem ${CAMINHO_DO_DOCUMENTO} — nao e um documento Word.`,
    );
  }

  return { pacote, documentoXml: await documento.async('string') };
}

/** Troca o XML do documento e serializa o pacote de volta. */
export async function gravarDocx(pacote: JSZip, documentoXml: string): Promise<Buffer> {
  /**
   * `createFolders: false` nas DUAS pontas (aqui e no `loadAsync`) para o
   * pacote gerado ter exatamente as entradas do modelo. Sem isto o jszip
   * acrescenta uma entrada de diretorio `word/` que o modelo nao tem.
   */
  pacote.file(CAMINHO_DO_DOCUMENTO, documentoXml, { createFolders: false });

  return pacote.generateAsync(COMPRESSAO);
}
