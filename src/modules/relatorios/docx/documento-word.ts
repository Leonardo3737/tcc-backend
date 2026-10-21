/**
 * Preenchimento do `word/document.xml` de um .docx. FUNCOES PURAS, sobre texto.
 *
 * ---------------------------------------------------------------------------
 * POR QUE MANIPULAR O XML DO MODELO, E NAO GERAR UM DOCUMENTO NOVO
 *
 * O objetivo e entregar o documento OFICIAL preenchido, nao um parecido. Uma
 * biblioteca que constroi .docx do zero (como a `docx`) obrigaria a reescrever
 * margens, cabecalho com logotipo, estilos, bordas de tabela e espacamentos —
 * e cada divergencia seria descoberta por quem recebesse o relatorio. Gerar a
 * partir de HTML e pior ainda: perde a estrutura de tabela e nao produz um
 * arquivo editavel no Word com a mesma identidade.
 *
 * A alternativa usual, `docxtemplater`, exige marcar o modelo com
 * `{placeholders}`. Isso foi recusado por um motivo pratico: o modelo e um
 * documento que a coordenacao mantem e reenvia. Um modelo novo chegaria sem as
 * marcacoes, e alguem teria de reintroduzi-las a cada versao. Aqui a ancora e o
 * PROPRIO ROTULO visivel ("CURSO: "), entao um modelo atualizado continua
 * funcionando desde que os rotulos sejam os mesmos — e quando nao forem, o
 * `conferirAncoras` acusa no boot, nao no download.
 *
 * ---------------------------------------------------------------------------
 * O QUE PERMITE FAZER ISSO COM TEXTO, E NAO COM UM PARSER DE XML
 *
 * Nao e atalho: e uma propriedade verificada do modelo. Cada rotulo da
 * identificacao e UM UNICO `<w:r>` com UM `<w:t>` — nada esta quebrado em
 * pedacos, nada depende de contexto. As operacoes abaixo, por isso, se reduzem
 * a tres recortes locais em volta de um texto conhecido.
 *
 * As consequencias ficam registradas, porque sao reais: ancora que nao existir
 * mais no modelo nao e preenchida, e por isso toda ancora e conferida no boot;
 * e texto de valor passa por `escaparXml`, senao um nome com "&" produziria um
 * .docx que o Word recusa abrir.
 */

/**
 * Entidades XML. `&` primeiro, senao as substituicoes seguintes seriam
 * reescapadas (`&lt;` viraria `&amp;lt;`).
 *
 * Aspas nao precisam de escape em conteudo de elemento, mas entram porque o
 * custo e zero e a funcao passa a servir tambem para atributo.
 */
export function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Um `<w:t>` que preserva espacos nas pontas — sem isso o Word os descarta. */
function elementoTexto(valor: string): string {
  return `<w:t xml:space="preserve">${escaparXml(valor)}</w:t>`;
}

/**
 * Propriedades do run da ancora, SEM o negrito.
 *
 * O rotulo e negrito; o valor preenchido nao. E assim que um formulario
 * preenchido se le — e tambem o que deixa visivel, para quem revisa o
 * documento, o que o sistema escreveu e o que veio do modelo.
 *
 * As demais propriedades (fonte, tamanho) sao copiadas para o valor nao sair em
 * Calibri 11 no meio de um documento em Times New Roman.
 */
function propriedadesDoValor(runDaAncora: string): string {
  const props = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(runDaAncora);

  if (!props) {
    return '';
  }

  return props[0].replace(/<w:b\s*\/>/g, '').replace(/<w:b\s+[^>]*\/>/g, '');
}

interface Ancora {
  /** Inicio do `<w:r>` que contem o texto da ancora. */
  inicioDoRun: number;
  /** Fim do `</w:r>` desse run. */
  fimDoRun: number;
  /** Fim do `</w:p>` do paragrafo que o contem. */
  fimDoParagrafo: number;
  runInteiro: string;
}

/**
 * Localiza o run cujo `<w:t>` tem EXATAMENTE o texto da ancora.
 *
 * Exatamente, e nao "contem": "PERIODO:" apareceria dentro de "PERIODO DE
 * REALIZACAO:", e o preenchimento cairia no campo errado sem nada falhar.
 *
 * Devolve `null` quando a ancora nao existe. Quem chama decide o que fazer —
 * `conferirAncoras` transforma isso em erro de boot, e e ali que a decisao
 * mora.
 */
function localizar(xml: string, ancora: string): Ancora | null {
  const alvo = `>${escaparXml(ancora)}</w:t>`;
  const posicaoDoTexto = xml.indexOf(alvo);

  if (posicaoDoTexto === -1) {
    return null;
  }

  /**
   * Um run abre como `<w:r>` ou como `<w:r atributos>`. `Math.max` cobre os
   * dois e dispensa o caso "nao achou" (-1 perde de qualquer indice valido).
   *
   * Nem `<w:rPr>` nem `<w:rFonts>` sao confundidos: o primeiro nao casa com
   * `'<w:r '` (falta o espaco) nem com `'<w:r>'`, e o segundo tampouco.
   */
  const inicioDoRun = Math.max(
    xml.lastIndexOf('<w:r>', posicaoDoTexto),
    xml.lastIndexOf('<w:r ', posicaoDoTexto),
  );

  if (inicioDoRun === -1) {
    return null;
  }

  const fimDoRun = xml.indexOf('</w:r>', posicaoDoTexto) + '</w:r>'.length;
  const fimDoParagrafo = xml.indexOf('</w:p>', fimDoRun) + '</w:p>'.length;

  return {
    inicioDoRun,
    fimDoRun,
    fimDoParagrafo,
    runInteiro: xml.slice(inicioDoRun, fimDoRun),
  };
}

/** A ancora existe no documento? Base do `conferirAncoras`. */
export function temAncora(xml: string, ancora: string): boolean {
  return localizar(xml, ancora) !== null;
}

/**
 * ACRESCENTA o valor depois do rotulo, no mesmo paragrafo.
 *
 * E a operacao de "CURSO: " + "Ciencia da Computacao". Tudo que vier depois do
 * rotulo dentro do paragrafo e DESCARTADO antes, e isso e intencional: no
 * modelo, o titulo "RELATORIO FINAL DE MONITORIA ACADEMICA " e seguido de
 * "202", "6", "-2" em runs separados — resto de edicao manual de um semestre
 * anterior. Preencher sem limpar produziria "... 2026-22027-1".
 *
 * Valor vazio limpa o campo e nao escreve nada. Tambem e proposito: campo que
 * o sistema nao sabe preencher fica EM BRANCO para preenchimento manual, e um
 * valor obsoleto do modelo e pior que um espaco vazio.
 */
export function preencherRotulo(xml: string, ancora: string, valor: string): string {
  const achado = localizar(xml, ancora);

  if (!achado) {
    return xml;
  }

  const restoDoParagrafo = xml.slice(achado.fimDoRun, achado.fimDoParagrafo);
  const fechamento = restoDoParagrafo.slice(restoDoParagrafo.lastIndexOf('</w:p>'));

  const novoRun = valor
    ? `<w:r>${propriedadesDoValor(achado.runInteiro)}${elementoTexto(valor)}</w:r>`
    : '';

  return xml.slice(0, achado.fimDoRun) + novoRun + fechamento + xml.slice(achado.fimDoParagrafo);
}

/**
 * SUBSTITUI o texto do run da ancora, mantendo a formatacao dele.
 *
 * Para os campos que no modelo sao um EXEMPLO a ser trocado, nao um rotulo a
 * ser completado: "Nome do aluno" sob a linha de assinatura, "RA", "NOME DO
 * PROFESSOR". Preencher por acrescimo produziria "Nome do alunoAna Martins".
 *
 * Mantem o negrito, ao contrario de `preencherRotulo`: aqui o texto substituido
 * E o conteudo do campo, nao um rotulo ao lado dele.
 */
export function substituirTexto(xml: string, ancora: string, valor: string): string {
  const achado = localizar(xml, ancora);

  if (!achado) {
    return xml;
  }

  const runNovo = achado.runInteiro.replace(/<w:t(\s[^>]*)?>[\s\S]*?<\/w:t>/, elementoTexto(valor));

  return xml.slice(0, achado.inicioDoRun) + runNovo + xml.slice(achado.fimDoRun);
}

export interface LinhaDeAtividade {
  data: string;
  atividade: string;
  cargaHoraria: string;
  observacoes: string;
  quantidadeDeAlunos: string;
}

/** Posicao da primeira tabela do documento. */
function localizarTabela(xml: string): { inicio: number; fim: number } | null {
  const inicio = xml.indexOf('<w:tbl>');

  if (inicio === -1) {
    return null;
  }

  const fim = xml.indexOf('</w:tbl>', inicio) + '</w:tbl>'.length;
  return { inicio, fim };
}

function linhasDaTabela(tabela: string): string[] {
  return tabela.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? [];
}

/** Uma linha sem nenhum `<w:t>` nao tem texto em celula alguma. */
function estaVazia(linha: string): boolean {
  return !/<w:t[\s>]/.test(linha);
}

/**
 * Escreve os valores nas celulas de uma linha VAZIA do modelo.
 *
 * Cada celula vazia tem um `<w:p>` com `<w:pPr>` e nenhum run. O run e inserido
 * antes do `</w:p>`, herdando do `<w:rPr>` do paragrafo a fonte e o tamanho que
 * a tabela usa (Times New Roman 10) — sem isso o texto sairia na fonte padrao
 * do documento e a tabela ficaria com duas tipografias.
 */
function preencherCelulas(linhaVazia: string, valores: string[]): string {
  const celulas = linhaVazia.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];

  if (celulas.length === 0) {
    return linhaVazia;
  }

  let resultado = linhaVazia;

  celulas.forEach((celula, indice) => {
    const valor = valores[indice] ?? '';

    if (!valor) {
      return;
    }

    const propsDoParagrafo = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(celula);
    const props = propsDoParagrafo
      ? propsDoParagrafo[0].replace(/<w:b\s*\/>/g, '').replace(/<w:b\s+[^>]*\/>/g, '')
      : '';

    const comValor = celula.replace('</w:p>', `<w:r>${props}${elementoTexto(valor)}</w:r></w:p>`);

    resultado = resultado.replace(celula, comValor);
  });

  return resultado;
}

/**
 * Reconstroi a tabela de atividades: cabecalho + dados + linhas em branco.
 *
 * DUAS DECISOES, as duas visiveis no documento final:
 *
 *  1. TODA linha preenchida do modelo e DESCARTADA. No modelo elas sao exemplo
 *     ("Reforco da aula de Farmacologia da Esquizofrenia"), e um relatorio
 *     oficial que chega com dados de outra pessoa e pior que um vazio. O
 *     criterio e estrutural, nao uma lista de textos a remover: linha com
 *     qualquer texto e exemplo, porque o modelo preenchido nao existe.
 *
 *  2. LINHAS EM BRANCO SOBRAM SEMPRE, mesmo quando ha muitos atendimentos. O
 *     relatorio tem campos que so o monitor preenche — observacoes e
 *     quantidade de alunos de cada atividade, e as atividades que nao foram
 *     atendimentos registrados no sistema. Entregar a tabela cheia ate a ultima
 *     linha obrigaria quem assina a inserir linhas no Word.
 *
 * A linha em branco do modelo e o molde de todas as linhas novas, entao bordas,
 * larguras e alinhamento vem do proprio documento — nao ha HTML nem estilo
 * reconstruido a mao.
 */
export function preencherTabelaDeAtividades(
  xml: string,
  linhas: LinhaDeAtividade[],
  vaziasExtras: number,
): string {
  const tabela = localizarTabela(xml);

  if (!tabela) {
    return xml;
  }

  const conteudo = xml.slice(tabela.inicio, tabela.fim);
  const todas = linhasDaTabela(conteudo);

  if (todas.length < 2) {
    return xml;
  }

  const cabecalho = todas[0];
  const molde = todas.slice(1).find(estaVazia);

  if (!molde) {
    return xml;
  }

  const preenchidas = linhas.map((linha) =>
    preencherCelulas(molde, [
      linha.data,
      linha.atividade,
      linha.cargaHoraria,
      linha.observacoes,
      linha.quantidadeDeAlunos,
    ]),
  );

  const emBranco = Array.from({ length: Math.max(0, vaziasExtras) }, () => molde);

  /**
   * Recorta SO o trecho das linhas. O que vem antes (`<w:tblPr>` com bordas e
   * `<w:tblGrid>` com as larguras das colunas) e o que vem depois ficam
   * intactos — e ali que mora a formatacao da tabela.
   */
  const inicioDasLinhas = conteudo.indexOf(cabecalho);
  const fimDasLinhas = conteudo.lastIndexOf('</w:tr>') + '</w:tr>'.length;

  const novaTabela =
    conteudo.slice(0, inicioDasLinhas) +
    cabecalho +
    [...preenchidas, ...emBranco].join('') +
    conteudo.slice(fimDasLinhas);

  return xml.slice(0, tabela.inicio) + novaTabela + xml.slice(tabela.fim);
}
