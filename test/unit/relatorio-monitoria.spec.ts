import { NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  formatarCargaHoraria,
  minutosEmCargaHoraria,
} from '../../src/modules/analytics/carga-horaria';
import { abrirDocx, gravarDocx } from '../../src/modules/relatorios/docx/pacote-docx';
import {
  escaparXml,
  preencherRotulo,
  preencherTabelaDeAtividades,
  substituirTexto,
  temAncora,
} from '../../src/modules/relatorios/docx/documento-word';
import {
  ANCORAS,
  RelatorioMonitoriaService,
} from '../../src/modules/relatorios/relatorio-monitoria.service';

/**
 * Relatorio final de monitoria em .docx, e a carga horaria que ele usa.
 *
 * O que estes testes protegem nao e "o arquivo e gerado": e um conjunto de
 * decisoes que, se desfeitas, produzem um documento que ABRE e esta ERRADO —
 * o pior tipo de defeito aqui, porque ninguem percebe sem conferir o arquivo:
 *
 *  - o pacote preserva TUDO menos o `document.xml` (cabecalho, logotipo,
 *    estilos, tema);
 *  - as linhas de EXEMPLO do modelo nunca chegam ao relatorio de ninguem;
 *  - sempre sobram linhas em branco para o preenchimento manual;
 *  - campo que o sistema nao sabe preencher sai VAZIO, nao com palpite;
 *  - valor com `&` nao corrompe o XML;
 *  - a carga horaria soma so os REALIZADOS e arredonda uma vez.
 *
 * O modelo REAL e lido do disco. Usar um XML falso provaria apenas que as
 * funcoes funcionam sobre o que eu mesmo escrevi — e a ancora quebrar por causa
 * de um espaco no modelo e justamente o risco deste desenho.
 */

const MODELO = join(
  __dirname,
  '..',
  '..',
  'src',
  'modules',
  'relatorios',
  'modelo',
  'relatorio-monitoria.docx',
);

const modeloEmBytes = readFileSync(MODELO);

async function xmlDoModelo(): Promise<string> {
  return (await abrirDocx(modeloEmBytes)).documentoXml;
}

/** Texto de cada paragrafo, com as entidades XML decodificadas. */
function paragrafos(xml: string): string[] {
  return (xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []).map((p) =>
    (p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) ?? [])
      .map((t) => t.replace(/<[^>]+>/g, ''))
      .join('')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&'),
  );
}

function linhasDaTabela(xml: string): string[][] {
  return (xml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? []).map((tr) =>
    (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((tc) =>
      (tc.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join(''),
    ),
  );
}

const ATIVIDADE = {
  data: '05/08/2026 - Quarta',
  atividade: 'Revisao de limites',
  cargaHoraria: '1h30min',
  observacoes: '',
  quantidadeDeAlunos: '4',
};

/* ------------------------------------------------------- carga horaria */

describe('minutosEmCargaHoraria', () => {
  /**
   * Minuto e a unidade canonica porque e exata. Hora decimal nao representa
   * 1h20min sem dizima, e carga horaria que nao fecha na conta do aluno e pior
   * que uma unidade menos conveniente.
   */
  it('devolve os minutos intactos e as horas com 2 casas', () => {
    expect(minutosEmCargaHoraria(1265)).toEqual({
      cargaHorariaMinutos: 1265,
      cargaHorariaHoras: 21.08,
    });
  });

  it('zero minutos nao vira nulo nem NaN', () => {
    expect(minutosEmCargaHoraria(0)).toEqual({
      cargaHorariaMinutos: 0,
      cargaHorariaHoras: 0,
    });
  });

  /** Campo numerico que ora e numero ora e texto obriga o cliente a adivinhar. */
  it('as horas sao NUMERO, nao string', () => {
    expect(typeof minutosEmCargaHoraria(90).cargaHorariaHoras).toBe('number');
    expect(minutosEmCargaHoraria(80).cargaHorariaHoras).toBe(1.33);
  });
});

describe('formatarCargaHoraria', () => {
  /**
   * Nao usa hora decimal de proposito: "1,33h" obriga quem assina o documento a
   * fazer a conta de cabeca para conferir as 40h exigidas.
   */
  it.each([
    [0, ''],
    [45, '45min'],
    [60, '1h'],
    [90, '1h30min'],
    [65, '1h05min'],
    [2400, '40h'],
  ])('%d minutos -> "%s"', (minutos, esperado) => {
    expect(formatarCargaHoraria(minutos)).toBe(esperado);
  });

  /** "2h5min" se le como duas horas e cinco; "2h05min" nao deixa duvida. */
  it('os minutos acompanham a hora com dois digitos', () => {
    expect(formatarCargaHoraria(125)).toBe('2h05min');
  });
});

/* ------------------------------------------------- operacoes sobre o XML */

describe('escaparXml', () => {
  /**
   * O teste que evita o pior defeito possivel: um nome com "&" produziria um
   * .docx que o Word simplesmente RECUSA abrir — e a geracao nao falharia.
   */
  it('escapa & antes dos demais, sem reescapar', () => {
    expect(escaparXml('A & B < C')).toBe('A &amp; B &lt; C');
    expect(escaparXml('&lt;')).toBe('&amp;lt;');
  });
});

describe('temAncora — o modelo real tem todos os rotulos', () => {
  /**
   * Espelha o que `onModuleInit` confere no boot. Se alguem trocar o modelo por
   * uma versao com "CURSO :" em vez de "CURSO: ", o relatorio sairia com o
   * campo vazio e sem erro nenhum — este teste e a rede antes do boot.
   */
  it.each(Object.entries(ANCORAS))('%s existe no modelo', async (_campo, ancora) => {
    expect(temAncora(await xmlDoModelo(), ancora)).toBe(true);
  });

  it('ancora inexistente e detectada', async () => {
    expect(temAncora(await xmlDoModelo(), 'CAMPO QUE NAO EXISTE:')).toBe(false);
  });
});

describe('preencherRotulo', () => {
  it('acrescenta o valor depois do rotulo, no mesmo paragrafo', async () => {
    const xml = preencherRotulo(await xmlDoModelo(), ANCORAS.curso, 'Ciencia da Computacao');

    expect(paragrafos(xml)).toContain('CURSO: Ciencia da Computacao');
  });

  /**
   * No modelo, o titulo e seguido de "202", "6", "-2" em runs separados — resto
   * de edicao manual de um semestre anterior. Sem limpar, o preenchimento
   * produziria "2026-22027-1".
   */
  it('descarta o que vinha depois do rotulo no paragrafo', async () => {
    const xml = preencherRotulo(await xmlDoModelo(), ANCORAS.titulo, '2027-1');
    const titulo = paragrafos(xml).find((p) => p.startsWith('RELATÓRIO FINAL'));

    expect(titulo).toBe('RELATÓRIO FINAL DE MONITORIA ACADÊMICA 2027-1');
    expect(titulo).not.toContain('2026');
  });

  /**
   * Campo que o sistema nao sabe preencher fica EM BRANCO. O modelo trazia
   * "Entrega: 01/12/2026", data escrita a mao de outro semestre: manter data
   * errada em documento oficial e pior que deixar o campo vazio.
   */
  it('valor vazio limpa o campo e nao escreve nada', async () => {
    const xml = preencherRotulo(await xmlDoModelo(), ANCORAS.entrega, '');

    expect(paragrafos(xml)).toContain('Entrega: ');
    expect(xml).not.toContain('01/12/2026');
  });

  it('escapa o valor, mantendo o XML valido', async () => {
    const xml = preencherRotulo(await xmlDoModelo(), ANCORAS.monitor, 'Ana & Silva <x>');

    expect(xml).toContain('Ana &amp; Silva &lt;x&gt;');
    expect(paragrafos(xml)).toContain('MONITOR(A): Ana & Silva <x>');
  });

  /** Ancora ausente nao quebra nem corrompe: devolve o documento como estava. */
  it('ancora inexistente devolve o xml intacto', async () => {
    const original = await xmlDoModelo();

    expect(preencherRotulo(original, 'NAO EXISTE:', 'x')).toBe(original);
  });

  /**
   * Igualdade, nao "contem". "PERÍODO:" aparece dentro de outros rotulos em
   * modelos parecidos, e preencher o campo errado nao falharia em lugar algum.
   */
  it('casa o texto do run por igualdade', async () => {
    const xml = preencherRotulo(await xmlDoModelo(), ANCORAS.periodo, ' 01/08 a 15/12');
    const linhas = paragrafos(xml);

    expect(linhas).toContain('PERÍODO: 01/08 a 15/12');
    expect(linhas).toContain('TURNO:');
  });
});

describe('substituirTexto', () => {
  /**
   * Sob a linha de assinatura o modelo traz EXEMPLOS ("Nome do aluno", "RA"),
   * nao rotulos. Acrescentar produziria "Nome do alunoAna Martins".
   */
  it('troca o texto do run em vez de acrescentar', async () => {
    const xml = substituirTexto(await xmlDoModelo(), ANCORAS.nomeNaAssinatura, 'Ana Martins');
    const linhas = paragrafos(xml);

    expect(linhas).toContain('Ana Martins');
    expect(linhas).not.toContain('Nome do aluno');
  });

  it('escapa o valor', async () => {
    const xml = substituirTexto(await xmlDoModelo(), ANCORAS.raNaAssinatura, 'A&B');

    expect(xml).toContain('A&amp;B');
  });
});

describe('preencherTabelaDeAtividades', () => {
  /**
   * A decisao mais importante da tabela: o modelo vem com linhas de exemplo
   * ("Reforço da aula de Farmacologia da Esquizofrenia"), e um relatorio
   * oficial que chega com dados de outra pessoa e pior que um vazio.
   */
  it('remove TODAS as linhas de exemplo do modelo', async () => {
    const xml = preencherTabelaDeAtividades(await xmlDoModelo(), [ATIVIDADE], 5);

    expect(xml).not.toContain('Farmacologia da Esquizofrenia');
    expect(xml).not.toContain('09/05/2023');
    expect(xml).not.toContain('Grupo de estudos');
  });

  it('mantem o cabecalho e escreve uma linha por atividade', async () => {
    const xml = preencherTabelaDeAtividades(
      await xmlDoModelo(),
      [ATIVIDADE, { ...ATIVIDADE, data: '12/08/2026 - Quarta', atividade: 'Lista' }],
      3,
    );

    const linhas = linhasDaTabela(xml);

    expect(linhas[0]).toEqual([
      'DATA',
      'ATIVIDADE REALIZADA',
      'Carga horária',
      'OBSERVAÇÕES',
      'Quantidade de Alunos',
    ]);
    expect(linhas[1]).toEqual(['05/08/2026 - Quarta', 'Revisao de limites', '1h30min', '', '4']);
    expect(linhas[2][1]).toBe('Lista');
  });

  /**
   * Sobram linhas em branco SEMPRE. Observacoes, quantidade de alunos por
   * sessao e as atividades que nao viraram atendimento no sistema sao do
   * monitor; entregar a tabela cheia obrigaria quem assina a inserir linhas no
   * Word.
   */
  it('deixa as linhas em branco pedidas depois dos dados', async () => {
    const linhas = linhasDaTabela(preencherTabelaDeAtividades(await xmlDoModelo(), [ATIVIDADE], 6));

    expect(linhas).toHaveLength(1 + 1 + 6);
    expect(linhas.slice(2).every((linha) => linha.every((celula) => celula === ''))).toBe(true);
  });

  /** Mais atividades que linhas no modelo: as linhas sao clonadas do molde. */
  it('nao tem teto de atividades', async () => {
    const muitas = Array.from({ length: 30 }, (_, i) => ({
      ...ATIVIDADE,
      atividade: `Atividade ${i + 1}`,
    }));

    const linhas = linhasDaTabela(preencherTabelaDeAtividades(await xmlDoModelo(), muitas, 4));

    expect(linhas).toHaveLength(1 + 30 + 4);
    expect(linhas[30][1]).toBe('Atividade 30');
  });

  it('sem atividade nenhuma, a tabela fica so com cabecalho e linhas em branco', async () => {
    const linhas = linhasDaTabela(preencherTabelaDeAtividades(await xmlDoModelo(), [], 8));

    expect(linhas).toHaveLength(9);
    expect(linhas.slice(1).every((linha) => linha.every((celula) => celula === ''))).toBe(true);
  });

  it('escapa o conteudo das celulas', async () => {
    const xml = preencherTabelaDeAtividades(
      await xmlDoModelo(),
      [{ ...ATIVIDADE, atividade: 'Listas & provas' }],
      1,
    );

    expect(xml).toContain('Listas &amp; provas');
  });
});

/* ------------------------------------------------------ pacote .docx */

describe('pacote .docx', () => {
  /**
   * A afirmacao central: nada alem do `document.xml` e tocado. E por isso que
   * cabecalho com logotipo, estilos, tema, fontes e margens saem identicos ao
   * documento oficial sem que nenhuma linha de codigo os descreva.
   */
  it('regrava alterando SOMENTE word/document.xml', async () => {
    const { pacote, documentoXml } = await abrirDocx(modeloEmBytes);
    const gerado = await gravarDocx(pacote, documentoXml.replace('CURSO: ', 'CURSO: X'));

    const original = await abrirDocx(modeloEmBytes);
    const novo = await abrirDocx(gerado);

    const nomes = (p: typeof novo.pacote) => Object.keys(p.files).sort();
    expect(nomes(novo.pacote)).toEqual(nomes(original.pacote));

    const diferentes: string[] = [];

    for (const nome of nomes(original.pacote)) {
      const antes = await original.pacote.file(nome)!.async('base64');
      const depois = await novo.pacote.file(nome)!.async('base64');

      if (antes !== depois) {
        diferentes.push(nome);
      }
    }

    expect(diferentes).toEqual(['word/document.xml']);
  });

  it('recusa conteudo que nao e um pacote .docx', async () => {
    await expect(abrirDocx(Buffer.from('isto nao e um zip'))).rejects.toThrow(/nao e um pacote/);
  });

  /** ZIP valido sem `word/document.xml` nao e um documento Word. */
  it('recusa pacote sem o documento', async () => {
    const { pacote } = await abrirDocx(modeloEmBytes);
    pacote.remove('word/document.xml');

    await expect(abrirDocx(await pacote.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(
      /nao contem word\/document\.xml/,
    );
  });
});

/* ------------------------------------------------- servico de relatorio */

function montar(
  opcoes: { cabecalho?: Record<string, unknown>[]; atendimentos?: Record<string, unknown>[] } = {},
) {
  const {
    cabecalho = [
      {
        disciplina_codigo: 'CAL001',
        disciplina_nome: 'Calculo Diferencial e Integral I',
        ano: 2026,
        semestre: 2,
        data_inicio: '2026-08-01',
        data_fim: '2026-12-15',
        professor_nome: 'Joao Ribeiro',
        monitor_nome: 'Ana Martins',
        monitor_email: 'ana@ufx.edu.br',
        monitor_matricula: '2021001234',
        curso_nome: 'Ciencia da Computacao',
      },
    ],
    atendimentos = [
      { inicio: new Date('2026-08-05T17:00:00Z'), assunto: 'Revisao', minutos: 90, presentes: 4 },
    ],
  } = opcoes;

  const query = jest.fn().mockResolvedValueOnce(cabecalho).mockResolvedValueOnce(atendimentos);

  const analyticsService = {
    monitores: jest
      .fn()
      .mockResolvedValue([{ participanteId: 'part-1', cargaHorariaMinutos: 195 }]),
  };

  return {
    service: new RelatorioMonitoriaService(
      { query } as never,
      analyticsService as never,
      { getOrThrow: jest.fn().mockReturnValue('America/Porto_Velho') } as never,
    ),
    query,
    analyticsService,
  };
}

const CONTEXTO = {
  monitoria: { id: 'mon-1' },
  participacao: { id: 'part-1' },
  ehProfessorResponsavel: false,
  papel: 'MONITOR',
} as never;

describe('RelatorioMonitoriaService.gerar', () => {
  it('produz um .docx legivel, com os campos preenchidos', async () => {
    const { service } = montar();

    const { conteudo, nomeDoArquivo } = await service.gerar(CONTEXTO);
    const { documentoXml } = await abrirDocx(conteudo);
    const linhas = paragrafos(documentoXml);

    expect(nomeDoArquivo).toBe('relatorio-monitoria-CAL001-2026-2-2021001234.docx');
    expect(linhas).toContain('CURSO: Ciencia da Computacao');
    expect(linhas).toContain('DISCIPLINA: CAL001 — Calculo Diferencial e Integral I');
    expect(linhas).toContain('PERÍODO: 01/08/2026 a 15/12/2026');
    expect(linhas).toContain('PROFESSOR-ORIENTADOR(A): Joao Ribeiro');
    expect(linhas).toContain('MONITOR(A): Ana Martins');
    expect(linhas).toContain('MATRÍCULA DO ALUNO-MONITOR(A): 2021001234');
    expect(linhas).toContain('EMAIL: ana@ufx.edu.br');
    expect(linhas).toContain('RELATÓRIO FINAL DE MONITORIA ACADÊMICA 2026-2');
  });

  /**
   * A regra que o escopo repete: campo que depende de relato ou que o banco nao
   * tem fica EM BRANCO. Afirmado pelo texto exato do rotulo — se alguem
   * resolver "deduzir" o turno a partir do horario dos atendimentos, este teste
   * acusa.
   */
  it('deixa em branco o que o sistema nao sabe', async () => {
    const { service } = montar();

    const { conteudo } = await service.gerar(CONTEXTO);
    const linhas = paragrafos((await abrirDocx(conteudo)).documentoXml);

    expect(linhas).toContain('TURNO:');
    expect(linhas).toContain('DIAS / HORÁRIOS DAS AULAS: ');
    expect(linhas).toContain('QUANTIDADE DE ALUNOS NA TURMA:');
    expect(linhas).toContain('TELEFONE: ');
    expect(linhas).toContain('TITULAÇÃO DO PROFESSOR-ORIENTADOR(A): ');
    expect(linhas).toContain('Entrega: ');
  });

  /** Os campos de relato continuam como instrucao, nao preenchidos. */
  it('preserva as secoes de preenchimento manual', async () => {
    const { service } = montar();

    const { conteudo } = await service.gerar(CONTEXTO);
    const linhas = paragrafos((await abrirDocx(conteudo)).documentoXml);

    expect(linhas).toContain(
      '- Descrever as principais atividades realizadas na monitoria acadêmica. ',
    );
    expect(linhas).toContain(
      '- Descrever a bibliografia utilizada para a monitoria de acordo com as normas da ABNT.',
    );
  });

  /**
   * A carga horaria do documento vem do MESMO metodo que alimenta o endpoint de
   * indicadores. Uma soma propria aqui faria o .docx e a tela divergirem — e os
   * dois numeros nunca aparecem juntos para alguem notar.
   */
  it('usa a carga horaria do endpoint de indicadores', async () => {
    const { service, analyticsService } = montar();

    const { conteudo } = await service.gerar(CONTEXTO);
    const linhas = paragrafos((await abrirDocx(conteudo)).documentoXml);

    expect(analyticsService.monitores).toHaveBeenCalledWith('mon-1');
    expect(linhas.find((l) => l.startsWith('DATA ATIVIDADES'))).toContain('3h15min');
  });

  it('escreve uma linha por atendimento realizado, com as presencas', async () => {
    const { service } = montar({
      atendimentos: [
        { inicio: new Date('2026-08-05T17:00:00Z'), assunto: 'Revisao', minutos: 90, presentes: 4 },
        { inicio: new Date('2026-08-12T17:00:00Z'), assunto: 'Listas', minutos: 60, presentes: 2 },
      ],
    });

    const { conteudo } = await service.gerar(CONTEXTO);
    const linhas = linhasDaTabela((await abrirDocx(conteudo)).documentoXml);

    expect(linhas[1]).toEqual(['05/08/2026 - Quarta', 'Revisao', '1h30min', '', '4']);
    expect(linhas[2]).toEqual(['12/08/2026 - Quarta', 'Listas', '1h', '', '2']);
  });

  /**
   * O recorte da tabela e o MESMO da carga horaria (somente REALIZADO) — e
   * precisa ser: se a tabela listasse AGENDADOS, a soma das linhas nao bateria
   * com o total do cabecalho e o documento se contradiria.
   */
  it('consulta apenas atendimentos REALIZADOS do vinculo', async () => {
    const { service, query } = montar();

    await service.gerar(CONTEXTO);

    const [sql, opcoes] = query.mock.calls[1];

    expect(sql).toContain("a.status = 'REALIZADO'");
    expect(sql).toContain('a.monitor_participante_id = :participanteId');
    expect((opcoes as { replacements: object }).replacements).toEqual({
      participanteId: 'part-1',
    });
  });

  /**
   * Vigencia indefinida e o normal de uma monitoria PLANEJADA. "a partir de
   * 01/08/2026" seria afirmacao que o banco nao sustenta.
   */
  it('PERIODO fica em branco quando a monitoria nao tem vigencia', async () => {
    const { service } = montar({
      cabecalho: [
        {
          disciplina_codigo: 'CAL001',
          disciplina_nome: 'Calculo',
          ano: 2026,
          semestre: 2,
          data_inicio: null,
          data_fim: null,
          professor_nome: 'Joao',
          monitor_nome: 'Ana',
          monitor_email: 'ana@ufx.edu.br',
          monitor_matricula: '2021001234',
          curso_nome: 'Computacao',
        },
      ],
    });

    const { conteudo } = await service.gerar(CONTEXTO);

    expect(paragrafos((await abrirDocx(conteudo)).documentoXml)).toContain('PERÍODO:');
  });

  /** Sem atendimento realizado, o documento sai valido e sem numero inventado. */
  it('monitoria sem atendimento realizado gera documento valido', async () => {
    const { service, analyticsService } = montar({ atendimentos: [] });
    analyticsService.monitores.mockResolvedValue([
      { participanteId: 'part-1', cargaHorariaMinutos: 0 },
    ]);

    const { conteudo } = await service.gerar(CONTEXTO);
    const { documentoXml } = await abrirDocx(conteudo);

    expect(linhasDaTabela(documentoXml)).toHaveLength(9);
    expect(paragrafos(documentoXml)).toContain(
      'DATA ATIVIDADES REALIZADAS (o aluno deve cumprir 40h de atividades realizadas descritas abaixo)',
    );
  });

  it('404 quando o vinculo nao existe no banco', async () => {
    const { service } = montar({ cabecalho: [] });

    await expect(service.gerar(CONTEXTO)).rejects.toThrow(NotFoundException);
  });

  /**
   * O relatorio e do vinculo que o guard resolveu a partir do TOKEN. Sem
   * vinculo nao ha relatorio — e nao ha parametro algum que permita pedir o de
   * outra pessoa.
   */
  it('404 quando o contexto nao traz vinculo ativo', async () => {
    const { service, query } = montar();

    await expect(
      service.gerar({ monitoria: { id: 'mon-1' }, participacao: null } as never),
    ).rejects.toThrow(NotFoundException);

    expect(query).not.toHaveBeenCalled();
  });

  /** O nome vai no Content-Disposition: sem acento, espaco ou barra. */
  it('o nome do arquivo e seguro para cabecalho HTTP', async () => {
    const { service } = montar({
      cabecalho: [
        {
          disciplina_codigo: 'CÁL/001',
          disciplina_nome: 'Calculo',
          ano: 2026,
          semestre: 2,
          data_inicio: null,
          data_fim: null,
          professor_nome: 'Joao',
          monitor_nome: 'Ana',
          monitor_email: 'ana@ufx.edu.br',
          monitor_matricula: '2021 00/1234',
          curso_nome: 'Computacao',
        },
      ],
    });

    const { nomeDoArquivo } = await service.gerar(CONTEXTO);

    expect(nomeDoArquivo).toBe('relatorio-monitoria-CL001-2026-2-2021001234.docx');
    expect(/^[\x20-\x7E]+$/.test(nomeDoArquivo)).toBe(true);
    expect(nomeDoArquivo).not.toMatch(/[ "/\\]/);
  });
});
