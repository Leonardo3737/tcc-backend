import { ConflictException } from '@nestjs/common';
import JSZip from 'jszip';

import { Turno } from '../../src/common/enums/turno.enum';
import { CampoOrdenacaoInscricao } from '../../src/modules/editais/dto/filtro-inscricoes.dto';
import { DirecaoOrdenacao } from '../../src/modules/atendimentos/dto/filtro-atendimentos.dto';
import {
  LinhaDaPlanilha,
  colunasDaPlanilha,
  montarPlanilhaDeInscricoes,
} from '../../src/modules/editais/planilha-de-inscricoes';
import {
  InscricoesEditalService,
  LIMITE_DE_EXPORTACAO,
} from '../../src/modules/editais/inscricoes-edital.service';

/**
 * Exportacao das inscricoes em .xlsx.
 *
 * O que estes testes protegem sao os defeitos que produzem uma planilha que
 * ABRE e esta errada — os unicos perigosos aqui, porque ninguem confere linha
 * por linha um arquivo que o Excel aceitou:
 *
 *  - nota ausente virar ZERO, falseando qualquer media calculada na planilha;
 *  - nota gravada como TEXTO, que nao soma nem ordena;
 *  - a planilha conter um recorte diferente do que a listagem mostra;
 *  - um recorte grande sair TRUNCADO parecendo completo;
 *  - `NULLS LAST` se perder e candidato sem nota aparecer como primeiro
 *    colocado.
 */

const LINHA: LinhaDaPlanilha = {
  email: 'maria@ufx.edu.br',
  nomeCompleto: 'Maria Oliveira',
  matricula: '2021001234',
  curso: 'Ciencia da Computacao',
  disciplina: 'Banco de Dados',
  professor: 'Joao Ribeiro',
  turno: Turno.NOTURNO,
  n1: 8.5,
  n2: 9.25,
  media: 8.88,
};

/**
 * Le a planilha gerada de volta: celulas, tipos e formatos.
 *
 * Sem biblioteca de leitura — o `sheet1.xml` de um .xlsx diz tudo o que
 * interessa. Uma celula de texto carrega `t="s"` (indice em `sharedStrings`) e
 * uma numerica nao carrega `t` nenhum; celula vazia simplesmente nao existe no
 * XML. Afirmar sobre o ARQUIVO, e nao sobre o objeto que montei, e o unico jeito
 * de provar que o tipo chegou ao Excel.
 */
async function lerPlanilha(bytes: Buffer) {
  const pacote = await JSZip.loadAsync(bytes);
  const folha = await pacote.file('xl/worksheets/sheet1.xml')!.async('string');
  const compartilhadas = pacote.file('xl/sharedStrings.xml')
    ? await pacote.file('xl/sharedStrings.xml')!.async('string')
    : '';

  const textos = [...compartilhadas.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) =>
    m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  );

  const linhas = [...folha.matchAll(/<row[\s>][\s\S]*?<\/row>/g)].map((linha) => {
    const celulas = [...linha[0].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)];

    return celulas.map((celula) => {
      const atributos = celula[1];
      const conteudo = celula[2] ?? '';
      const valor = /<v>([\s\S]*?)<\/v>/.exec(conteudo)?.[1] ?? null;
      const ehTexto = /t="s"/.test(atributos);

      return {
        referencia: /r="([A-Z]+\d+)"/.exec(atributos)?.[1] ?? '',
        tipo: ehTexto ? 'texto' : valor === null ? 'vazia' : 'numero',
        valor: valor === null ? null : ehTexto ? textos[Number(valor)] : Number(valor),
      };
    });
  });

  return { linhas, entradas: Object.keys(pacote.files).sort() };
}

/* ------------------------------------------------------- a planilha */

describe('colunasDaPlanilha', () => {
  /** A ordem foi pedida; fixa-la evita que uma coluna nova entre no meio. */
  it('tem as 10 colunas na ordem combinada', () => {
    expect(colunasDaPlanilha()).toEqual([
      'E-mail do aluno',
      'Nome do aluno',
      'Matrícula do aluno',
      'Curso',
      'Disciplina',
      'Nome do professor',
      'Turno',
      'Nota N1',
      'Nota N2',
      'Média',
    ]);
  });
});

describe('montarPlanilhaDeInscricoes', () => {
  it('gera um .xlsx legivel, com as partes do formato', async () => {
    const { entradas } = await lerPlanilha(await montarPlanilhaDeInscricoes([LINHA]));

    expect(entradas).toContain('xl/worksheets/sheet1.xml');
    expect(entradas).toContain('xl/workbook.xml');
    expect(entradas).toContain('[Content_Types].xml');
  });

  it('a primeira linha e o cabecalho', async () => {
    const { linhas } = await lerPlanilha(await montarPlanilhaDeInscricoes([LINHA]));

    expect(linhas[0].map((c) => c.valor)).toEqual(colunasDaPlanilha());
  });

  it('escreve os dados na ordem das colunas', async () => {
    const { linhas } = await lerPlanilha(await montarPlanilhaDeInscricoes([LINHA]));

    expect(linhas[1].map((c) => c.valor)).toEqual([
      'maria@ufx.edu.br',
      'Maria Oliveira',
      '2021001234',
      'Ciencia da Computacao',
      'Banco de Dados',
      'Joao Ribeiro',
      'NOTURNO',
      8.5,
      9.25,
      8.88,
    ]);
  });

  /**
   * A afirmacao mais importante do arquivo. Numero gravado como texto alinha a
   * esquerda e e ignorado por `MEDIA()`, `MAIOR()` e pela ordenacao — a
   * planilha abre perfeita e nao serve para o que a banca precisa dela.
   */
  it('notas e media sao NUMERO, nao texto', async () => {
    const { linhas } = await lerPlanilha(await montarPlanilhaDeInscricoes([LINHA]));
    const tipos = linhas[1].map((c) => c.tipo);

    expect(tipos.slice(0, 7)).toEqual(Array(7).fill('texto'));
    expect(tipos.slice(7)).toEqual(['numero', 'numero', 'numero']);
  });

  /**
   * Zero numa coluna de nota e uma afirmacao: "tirou zero". `MEDIA()` sobre
   * uma coluna com zeros devolve um numero menor e plausivel, e ninguem
   * percebe. Celula vazia e o unico jeito de "sem nota" continuar sendo
   * ausencia dentro da planilha.
   */
  it('nota ausente vira celula VAZIA, nunca zero', async () => {
    const { linhas } = await lerPlanilha(
      await montarPlanilhaDeInscricoes([{ ...LINHA, n1: 7, n2: null, media: null }]),
    );

    const notas = linhas[1].slice(7);

    expect(notas[0]).toMatchObject({ tipo: 'numero', valor: 7 });
    expect(notas[1].valor).toBeNull();
    expect(notas[2].valor).toBeNull();
    expect(notas.map((c) => c.valor)).not.toContain(0);
  });

  it('uma linha por inscricao, na ordem recebida', async () => {
    const { linhas } = await lerPlanilha(
      await montarPlanilhaDeInscricoes([
        LINHA,
        { ...LINHA, nomeCompleto: 'Bruno', media: 6.5 },
        { ...LINHA, nomeCompleto: 'Carla', media: null },
      ]),
    );

    expect(linhas).toHaveLength(4);
    expect(linhas.slice(1).map((l) => l[1].valor)).toEqual(['Maria Oliveira', 'Bruno', 'Carla']);
  });

  it('sem inscricao nenhuma, a planilha sai valida e com o cabecalho', async () => {
    const { linhas } = await lerPlanilha(await montarPlanilhaDeInscricoes([]));

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toHaveLength(10);
  });

  /** Nome com `&` corromperia o XML da planilha. */
  it('escapa texto com caractere especial', async () => {
    const { linhas } = await lerPlanilha(
      await montarPlanilhaDeInscricoes([{ ...LINHA, nomeCompleto: 'Ana & Silva <x>' }]),
    );

    expect(linhas[1][1].valor).toBe('Ana & Silva <x>');
  });
});

/* ------------------------------------------- o recorte e o teto */

function montar(linhas: Record<string, unknown>[] = []) {
  const query = jest.fn().mockResolvedValue(linhas);

  const editaisService = {
    buscarOuFalhar: jest.fn().mockResolvedValue({ id: 'ed-1', ano: 2026, semestre: 2 }),
  };

  return {
    service: new InscricoesEditalService(
      {} as never,
      { findAll: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      { findAll: jest.fn().mockResolvedValue([]) } as never,
      { query } as never,
      editaisService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ),
    query,
    editaisService,
  };
}

/**
 * Sem `as never` aqui: o DTO tem campos opcionais que os testes nao preenchem, e
 * o cast fica nas CHAMADAS. Tipar a constante como `never` impediria o spread.
 */
const FILTRO = {
  editalId: 'ed-1',
  ordenarPor: CampoOrdenacaoInscricao.MEDIA,
  direcao: DirecaoOrdenacao.DESC,
};

function linhaCrua(sobrescrever: Record<string, unknown> = {}) {
  return {
    email: 'maria@ufx.edu.br',
    nome_completo: 'Maria Oliveira',
    matricula: '2021001234',
    curso: 'Computacao',
    disciplina: 'Banco de Dados',
    professor: 'Joao',
    turno: 'NOTURNO',
    n1: '8.50',
    n2: '9.25',
    media: '8.88',
    ...sobrescrever,
  };
}

describe('InscricoesEditalService.exportar', () => {
  it('seleciona as 10 colunas pedidas', async () => {
    const { service, query } = montar([linhaCrua()]);

    await service.exportar(FILTRO as never);

    const [sql] = query.mock.calls[0];

    for (const coluna of [
      'i.email',
      'i.nome_completo',
      'i.matricula',
      'c.nome  AS curso',
      'd.nome  AS disciplina',
      'up.nome AS professor',
      'i.turno',
      'i.n1',
      'i.n2',
      'i.media',
    ]) {
      expect(sql).toContain(coluna);
    }
  });

  /**
   * O recorte da planilha tem de ser o MESMO da listagem. Um WHERE proprio
   * divergiria no primeiro filtro novo, e a divergencia apareceria como linha
   * faltando numa planilha que a banca ja levou para a reuniao.
   */
  it('aplica os mesmos filtros da listagem, por replacements', async () => {
    const { service, query } = montar([linhaCrua()]);

    await service.exportar({
      ...FILTRO,
      cursoId: 'curso-1',
      disciplinaId: 'disc-1',
      turno: Turno.MATUTINO,
      professorId: 'prof-1',
      busca: "x'; DROP TABLE inscricoes_edital; --",
      ano: 2026,
      semestre: 2,
    } as never);

    const [sql, opcoes] = query.mock.calls[0];

    expect(sql).toContain('i.edital_id = :editalId');
    expect(sql).toContain('i.curso_id = :cursoId');
    expect(sql).toContain('i.disciplina_id = :disciplinaId');
    expect(sql).toContain('i.turno = :turno');
    expect(sql).toContain('i.professor_id = :professorId');
    expect(sql).toContain('e.ano = :ano');
    expect(sql).toContain('e.semestre = :semestre');
    expect(sql).not.toContain('DROP TABLE');
    expect((opcoes as { replacements: Record<string, unknown> }).replacements.busca).toBe(
      "%x'; DROP TABLE inscricoes_edital; --%",
    );
  });

  /** Nota ausente no topo de uma ordenacao decrescente seria "primeiro colocado". */
  it.each([
    [DirecaoOrdenacao.DESC, 'i.media DESC NULLS LAST'],
    [DirecaoOrdenacao.ASC, 'i.media ASC NULLS LAST'],
  ])('ordena com NULLS LAST em %s', async (direcao, esperado) => {
    const { service, query } = montar([linhaCrua()]);

    await service.exportar({ ...FILTRO, direcao } as never);

    expect(query.mock.calls[0][0]).toContain(esperado);
  });

  it('traduz o campo publico de ordenacao para a coluna real', async () => {
    const { service, query } = montar([linhaCrua()]);

    await service.exportar({ ...FILTRO, ordenarPor: CampoOrdenacaoInscricao.NOME } as never);

    expect(query.mock.calls[0][0]).toContain('i.nome_completo DESC NULLS LAST');
  });

  it('desempata por id, para a ordem nao variar entre exportacoes', async () => {
    const { service, query } = montar([linhaCrua()]);

    await service.exportar(FILTRO as never);

    expect(query.mock.calls[0][0]).toContain('i.id ASC');
  });

  /**
   * Planilha truncada abre, parece completa e nao esta — o pior resultado
   * possivel aqui. Recusar e a unica saida honesta.
   */
  it('RECUSA quando o recorte passa do teto, em vez de truncar', async () => {
    const demais = Array.from({ length: LIMITE_DE_EXPORTACAO + 1 }, () => linhaCrua());
    const { service } = montar(demais);

    await expect(service.exportar(FILTRO as never)).rejects.toThrow(ConflictException);
    await expect(service.exportar(FILTRO as never)).rejects.toThrow(/Restrinja/);
  });

  /** O teto e conferido pedindo UMA linha a mais, sem um COUNT separado. */
  it('pede uma linha a mais que o teto para saber se estourou', async () => {
    const { service, query } = montar([linhaCrua()]);

    await service.exportar(FILTRO as never);

    expect(query.mock.calls[0][0]).toContain(`LIMIT ${LIMITE_DE_EXPORTACAO + 1}`);
  });

  it('exatamente no teto ainda exporta', async () => {
    const noLimite = Array.from({ length: LIMITE_DE_EXPORTACAO }, () => linhaCrua());
    const { service } = montar(noLimite);

    const { total } = await service.exportar(FILTRO as never);

    expect(total).toBe(LIMITE_DE_EXPORTACAO);
  });

  /**
   * `numeric` chega do driver como STRING. Sem a conversao, a planilha sairia
   * com as notas em texto — e `null` tem de continuar `null`, nao virar 0.
   */
  it('converte numeric de string para numero e preserva o nulo', async () => {
    const { service } = montar([linhaCrua({ n2: null, media: null })]);

    const { conteudo } = await service.exportar(FILTRO as never);
    const { linhas } = await lerPlanilha(conteudo);

    expect(linhas[1][7]).toMatchObject({ tipo: 'numero', valor: 8.5 });
    expect(linhas[1][8].valor).toBeNull();
    expect(linhas[1][9].valor).toBeNull();
  });

  it('nomeia o arquivo pelo periodo do edital', async () => {
    const { service, editaisService } = montar([linhaCrua()]);

    const { nomeDoArquivo } = await service.exportar(FILTRO as never);

    expect(editaisService.buscarOuFalhar).toHaveBeenCalledWith('ed-1');
    expect(nomeDoArquivo).toBe('inscricoes-edital-2026-2.xlsx');
  });

  it('edital sem inscricao gera planilha so com o cabecalho', async () => {
    const { service } = montar([]);

    const { conteudo, total } = await service.exportar(FILTRO as never);
    const { linhas } = await lerPlanilha(conteudo);

    expect(total).toBe(0);
    expect(linhas).toHaveLength(1);
  });
});
