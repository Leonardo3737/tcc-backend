import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';

import { EditaisService } from '../../src/modules/editais/editais.service';
import {
  InscricoesEditalService,
  LIMITE_BOLETIM_BYTES,
  cabecalhoDeAnexo,
  nomeSeguroDeArquivo,
} from '../../src/modules/editais/inscricoes-edital.service';
import { notaInformada } from '../../src/modules/editais/dto/criar-inscricao.dto';
import { estaNoPeriodo } from '../../src/modules/editais/dto/edital-resposta.dto';
import { InscricaoRespostaDto } from '../../src/modules/editais/dto/inscricao-resposta.dto';
import { CampoOrdenacaoInscricao } from '../../src/modules/editais/dto/filtro-inscricoes.dto';
import { DirecaoOrdenacao } from '../../src/modules/atendimentos/dto/filtro-atendimentos.dto';
import { montarConfirmacao } from '../../src/modules/editais/mensagem-de-confirmacao';
import { Turno } from '../../src/common/enums/turno.enum';

/**
 * Editais e inscricoes de candidatos.
 *
 * Esta e a primeira parte do sistema que aceita ESCRITA de quem nao tem conta,
 * e os testes refletem isso: a maioria verifica recusa, nao sucesso. O que
 * precisa ficar provado e que a rota publica nao faz nada alem de gravar uma
 * candidatura — nao cria identidade, nao aceita media do cliente, nao aceita
 * arquivo que nao seja PDF e nao deixa dado de candidato escapar sem token.
 *
 * O que depende do PostgreSQL continua fora daqui, por decisao ja registrada no
 * jest.config.js: a coluna `media` GENERATED, as UNIQUE por edital e a FK
 * composta curso/disciplina sao verificadas contra banco real em
 * scripts/fluxo-completo.mjs. Testar constraint com model mockado so provaria
 * que o mock funciona.
 */

const EDITAL = {
  id: 'ed-1',
  inicioInscricoes: '2026-11-10',
  fimInscricoes: '2026-11-25',
  link: 'https://ufx.edu.br/edital.pdf',
  ano: 2026,
  semestre: 2,
  ativo: true,
  createdAt: new Date('2026-11-01T12:00:00Z'),
};

const CURSO = '11111111-1111-4111-8111-000000000001';
const DISCIPLINA = '22222222-2222-4222-8222-000000000002';
const PROFESSOR = '33333333-3333-4333-8333-000000000003';

/** PDF minimo: o que importa aqui e a assinatura nos cinco primeiros bytes. */
function pdf(): Buffer {
  return Buffer.from('%PDF-1.4\ntrailer<<>>\n%%EOF\n', 'latin1');
}

function arquivo(sobrescrever: Record<string, unknown> = {}) {
  const conteudo = pdf();

  return {
    originalname: 'boletim.pdf',
    mimetype: 'application/pdf',
    size: conteudo.length,
    buffer: conteudo,
    ...sobrescrever,
  } as never;
}

function dadosValidos(extra: Record<string, unknown> = {}) {
  return {
    nomeCompleto: 'Maria Oliveira',
    matricula: '2021001234',
    email: 'maria@ufx.edu.br',
    cursoId: CURSO,
    disciplinaId: DISCIPLINA,
    professorId: PROFESSOR,
    turno: Turno.NOTURNO,
    ...extra,
  } as never;
}

/* ------------------------------------------------------------------ puras */

describe('estaNoPeriodo', () => {
  /**
   * A comparacao e de STRINGS 'AAAA-MM-DD'. Nesse formato a ordem
   * lexicografica e a cronologica, e e por isso que nenhum `Date` aparece no
   * caminho — converter reintroduziria o fuso do processo na conta que o banco
   * acabou de fazer sem ele.
   */
  it.each([
    ['2026-11-10', true, 'primeiro dia'],
    ['2026-11-25', true, 'ultimo dia'],
    ['2026-11-17', true, 'meio do periodo'],
    ['2026-11-09', false, 'um dia antes'],
    ['2026-11-26', false, 'um dia depois'],
  ])('%s -> %s (%s)', (hoje, esperado) => {
    expect(estaNoPeriodo(EDITAL as never, hoje as string)).toBe(esperado);
  });

  /** O virar do ano e onde comparacao de texto falharia se o formato variasse. */
  it('funciona na virada do ano', () => {
    const edital = { inicioInscricoes: '2026-12-28', fimInscricoes: '2027-01-05' };

    expect(estaNoPeriodo(edital as never, '2026-12-31')).toBe(true);
    expect(estaNoPeriodo(edital as never, '2027-01-01')).toBe(true);
    expect(estaNoPeriodo(edital as never, '2027-01-06')).toBe(false);
  });
});

describe('notaInformada', () => {
  /**
   * O teste que justifica a funcao existir.
   *
   * A inscricao chega como multipart por causa do PDF, e ali campo em branco
   * chega como string vazia. `@Type(() => Number)` converteria isso em ZERO,
   * e o candidato apareceria na lista da banca com uma nota que ninguem lhe
   * deu. Em branco tem de virar "nao informado".
   */
  it('campo em branco NAO vira zero', () => {
    expect(notaInformada({ value: '' })).toBeUndefined();
    expect(notaInformada({ value: null })).toBeUndefined();
    expect(notaInformada({ value: undefined })).toBeUndefined();
  });

  it('converte texto numerico, inclusive decimal', () => {
    expect(notaInformada({ value: '8.5' })).toBe(8.5);
    expect(notaInformada({ value: '10' })).toBe(10);
    expect(notaInformada({ value: '0' })).toBe(0);
  });

  /** Zero DIGITADO e nota valida e tem de sobreviver — nao e o mesmo que vazio. */
  it('preserva o zero informado de proposito', () => {
    expect(notaInformada({ value: '0' })).toBe(0);
    expect(notaInformada({ value: 0 })).toBe(0);
  });

  it('texto nao numerico vira NaN, para o IsNumber recusar', () => {
    expect(notaInformada({ value: 'dez' })).toBeNaN();
  });
});

describe('nomeSeguroDeArquivo', () => {
  it('mantem nome comum', () => {
    expect(nomeSeguroDeArquivo('boletim-2021.pdf')).toBe('boletim-2021.pdf');
  });

  /** O nome vai dentro de um cabecalho HTTP: aspas e quebra de linha saem. */
  it('neutraliza o que quebraria o Content-Disposition', () => {
    const resultado = nomeSeguroDeArquivo('a"b\r\nX-Injetado: 1.pdf');

    expect(resultado).not.toContain('"');
    expect(resultado).not.toContain('\n');
    expect(resultado).not.toContain('\r');
    expect(resultado.endsWith('.pdf')).toBe(true);
  });

  it('descarta caminho e guarda so o nome base', () => {
    expect(nomeSeguroDeArquivo('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(nomeSeguroDeArquivo('C:\\Users\\ana\\boletim.pdf')).toBe('boletim.pdf');
  });

  it('garante a extensao sem duplica-la', () => {
    expect(nomeSeguroDeArquivo('historico')).toBe('historico.pdf');
    expect(nomeSeguroDeArquivo('historico.pdf')).toBe('historico.pdf');
    expect(nomeSeguroDeArquivo('historico.PDF')).toBe('historico.pdf');
  });

  it('nome vazio ou so-simbolos cai no padrao', () => {
    expect(nomeSeguroDeArquivo('')).toBe('boletim.pdf');
    expect(nomeSeguroDeArquivo('.pdf')).toBe('boletim.pdf');
  });

  it('respeita o limite da coluna', () => {
    expect(nomeSeguroDeArquivo(`${'a'.repeat(400)}.pdf`).length).toBeLessThanOrEqual(255);
  });
});

describe('cabecalhoDeAnexo', () => {
  /**
   * `attachment`, nunca `inline`: PDF renderizado a partir do nosso dominio e
   * superficie de execucao de conteudo de terceiro.
   */
  it('sempre anexa, nunca exibe embutido', () => {
    expect(cabecalhoDeAnexo('boletim.pdf')).toMatch(/^attachment;/);
  });

  it('acentos vao no filename* e o filename fica ASCII', () => {
    const cabecalho = cabecalhoDeAnexo('boletim-João.pdf');
    const [, ascii] = /filename="([^"]*)"/.exec(cabecalho) ?? [];

    expect(ascii).toBeDefined();
    expect(/^[\x20-\x7E]*$/.test(ascii!)).toBe(true);
    expect(cabecalho).toContain("filename*=UTF-8''");
    expect(cabecalho).toContain(encodeURIComponent('boletim-João.pdf'));
  });

  it('nao deixa aspas escaparem do valor entre aspas', () => {
    const cabecalho = cabecalhoDeAnexo('a"; evil="1.pdf');
    const [, ascii] = /filename="([^"]*)"/.exec(cabecalho) ?? [];

    expect(ascii).not.toContain('"');
  });
});

describe('montarConfirmacao', () => {
  const mensagem = montarConfirmacao({
    nomeCompleto: 'Maria Oliveira',
    email: 'maria@ufx.edu.br',
    inscricaoId: 'insc-123',
    ano: 2026,
    semestre: 2,
    fimInscricoes: '2026-11-25',
    linkDoEdital: 'https://ufx.edu.br/edital.pdf',
    urlDoSistema: 'https://monitoria.ufx.edu.br',
  });

  it('vai so para o candidato', () => {
    expect(mensagem.para).toEqual([{ email: 'maria@ufx.edu.br', nome: 'Maria Oliveira' }]);
  });

  it('informa nome, edital e identificador da inscricao', () => {
    expect(mensagem.texto).toContain('Maria Oliveira');
    expect(mensagem.texto).toContain('insc-123');
    expect(mensagem.texto).toContain('2026/2');
    expect(mensagem.texto).toContain('https://ufx.edu.br/edital.pdf');
  });

  /**
   * O escopo proibe anexar o boletim e pede para nao expor informacao
   * academica desnecessaria. Nota e media nao entram: o e-mail confirma um ATO,
   * nao e comprovante de desempenho, e trafega por servidor de terceiro.
   */
  it('nao carrega notas, media nem anexo', () => {
    expect(mensagem).not.toHaveProperty('anexos');
    expect(mensagem.texto).not.toMatch(/\bmedia\b/i);
    expect(mensagem.texto).not.toMatch(/\bnota\b/i);
    expect(mensagem.texto).not.toContain('boletim');
  });
});

describe('InscricaoRespostaDto.deModelo', () => {
  const inscricao = {
    id: 'insc-1',
    nomeCompleto: 'Maria Oliveira',
    matricula: '2021001234',
    email: 'maria@ufx.edu.br',
    turno: Turno.NOTURNO,
    n1: '8.50',
    n2: '9.25',
    media: '8.88',
    editalId: 'ed-1',
    cursoId: CURSO,
    disciplinaId: DISCIPLINA,
    professorId: PROFESSOR,
    edital: { ano: 2026, semestre: 2 },
    curso: { codigo: 'CIE001', nome: 'Computacao' },
    disciplina: { codigo: 'BAN001', nome: 'Banco de Dados' },
    professor: { usuario: { nome: 'Prof Carlos' } },
    createdAt: new Date('2026-11-12T14:00:00Z'),
  };

  /**
   * `numeric` chega do driver como STRING, de proposito — e assim que o `pg`
   * evita que 9.1 se torne 9.099999999999999. A conversao acontece na borda da
   * API, e e aqui que isso fica verificado.
   */
  it('converte numeric (string) para numero', () => {
    const dto = InscricaoRespostaDto.deModelo(inscricao as never);

    expect(dto.n1).toBe(8.5);
    expect(dto.n2).toBe(9.25);
    expect(dto.media).toBe(8.88);
  });

  it('nota ausente permanece NULA — nunca zero', () => {
    const dto = InscricaoRespostaDto.deModelo({
      ...inscricao,
      n1: '7.00',
      n2: null,
      media: null,
    } as never);

    expect(dto.n2).toBeNull();
    expect(dto.media).toBeNull();
    expect(dto.media).not.toBe(0);
  });

  it('expoe metadado do boletim, nunca o conteudo', () => {
    const dto = InscricaoRespostaDto.deModelo(
      inscricao as never,
      {
        nomeOriginal: 'boletim.pdf',
        tamanhoBytes: 2048,
        sha256: 'a'.repeat(64),
        conteudo: Buffer.from('%PDF-'),
      } as never,
    );

    expect(dto.boletim).toEqual({
      nomeOriginal: 'boletim.pdf',
      tamanhoBytes: 2048,
      sha256: 'a'.repeat(64),
    });
    expect(JSON.stringify(dto)).not.toContain('conteudo');
  });

  it('sem boletim e sem aluno cadastrado, os dois campos vem nulos', () => {
    const dto = InscricaoRespostaDto.deModelo(inscricao as never);

    expect(dto.boletim).toBeNull();
    expect(dto.alunoCadastrado).toBeNull();
  });

  it('aponta o aluno ja cadastrado quando ha um', () => {
    const dto = InscricaoRespostaDto.deModelo(inscricao as never, null, {
      usuarioId: 'u-9',
      cursoId: CURSO,
    } as never);

    expect(dto.alunoCadastrado).toEqual({ usuarioId: 'u-9', cursoId: CURSO });
  });
});

/* -------------------------------------------------------- EditaisService */

function montarEditais(
  edital: Record<string, unknown> | null = { ...EDITAL },
  hoje = '2026-11-17',
) {
  const instancia = edital
    ? { ...edital, update: jest.fn().mockImplementation(function (this: never) {}) }
    : null;

  const editalModel = {
    create: jest
      .fn()
      .mockImplementation((dados: Record<string, unknown>) =>
        Promise.resolve({ ...EDITAL, ...dados, update: jest.fn() }),
      ),
    findByPk: jest.fn().mockResolvedValue(instancia),
    findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
  };

  const sequelize = {
    query: jest.fn().mockResolvedValue([{ hoje }]),
  };

  return {
    service: new EditaisService(
      editalModel as never,
      sequelize as never,
      {
        getOrThrow: jest.fn().mockReturnValue('America/Porto_Velho'),
      } as never,
    ),
    editalModel,
    sequelize,
    instancia,
  };
}

describe('EditaisService.dataDeHoje', () => {
  /**
   * `new Date()` nao serve. O periodo e um intervalo de dias LOCAIS da
   * instituicao; um servidor em UTC viraria o dia tres horas antes de Porto
   * Velho e o edital abriria um dia adiantado. O `::text` evita que o driver
   * devolva `date` como Date em meia-noite do fuso do processo.
   */
  it('pede o dia ao PostgreSQL, no fuso da instituicao', async () => {
    const { service, sequelize } = montarEditais();

    await service.dataDeHoje();

    const [sql, opcoes] = sequelize.query.mock.calls[0];

    expect(sql).toContain('AT TIME ZONE :fuso');
    expect(sql).toContain('::date::text');
    expect(opcoes.replacements).toEqual({ fuso: 'America/Porto_Velho' });
  });
});

describe('EditaisService — periodo', () => {
  it('recusa criar com fim anterior ao inicio', async () => {
    const { service, editalModel } = montarEditais();

    await expect(
      service.criar({
        inicioInscricoes: '2026-11-25',
        fimInscricoes: '2026-11-10',
        link: 'https://ufx.edu.br/e.pdf',
        ano: 2026,
        semestre: 2,
      }),
    ).rejects.toThrow(ConflictException);

    expect(editalModel.create).not.toHaveBeenCalled();
  });

  it('aceita periodo de um unico dia', async () => {
    const { service, editalModel } = montarEditais();

    await service.criar({
      inicioInscricoes: '2026-11-10',
      fimInscricoes: '2026-11-10',
      link: 'https://ufx.edu.br/e.pdf',
      ano: 2026,
      semestre: 2,
    });

    expect(editalModel.create).toHaveBeenCalled();
  });

  /**
   * O PATCH valida o par RESULTANTE, nao o recebido.
   *
   * Mandar so `fimInscricoes` pode inverter o periodo contra a data de inicio
   * que ja esta gravada — e nenhuma validacao do DTO alcanca isso, porque o
   * outro valor nem veio na requisicao.
   */
  it('recusa editar so o fim quando o resultado inverte o periodo', async () => {
    const { service, instancia } = montarEditais();

    await expect(service.atualizar('ed-1', { fimInscricoes: '2026-11-01' })).rejects.toThrow(
      ConflictException,
    );

    expect(instancia!.update).not.toHaveBeenCalled();
  });

  it('aceita editar so o fim quando o resultado continua coerente', async () => {
    const { service, instancia } = montarEditais();

    await service.atualizar('ed-1', { fimInscricoes: '2026-12-20' });

    expect(instancia!.update).toHaveBeenCalledWith({ fimInscricoes: '2026-12-20' });
  });
});

describe('EditaisService.exigirAbertoParaInscricao', () => {
  it('devolve o edital quando hoje esta no periodo', async () => {
    const { service } = montarEditais({ ...EDITAL }, '2026-11-17');

    await expect(service.exigirAbertoParaInscricao('ed-1')).resolves.toMatchObject({ id: 'ed-1' });
  });

  it('404 quando o edital nao existe', async () => {
    const { service } = montarEditais(null);

    await expect(service.exigirAbertoParaInscricao('ed-1')).rejects.toThrow(NotFoundException);
  });

  /**
   * Edital EXCLUIDO responde 404, igual a inexistente.
   *
   * Para quem nao esta autenticado, confirmar que um id existe mas foi retirado
   * e informacao sobre a operacao interna da instituicao que a rota publica nao
   * tem razao para dar.
   */
  it('404 quando o edital foi excluido logicamente', async () => {
    const { service } = montarEditais({ ...EDITAL, ativo: false });

    await expect(service.exigirAbertoParaInscricao('ed-1')).rejects.toThrow(NotFoundException);
  });

  it('409 antes de abrir, dizendo quando abre', async () => {
    const { service } = montarEditais({ ...EDITAL }, '2026-11-01');

    await expect(service.exigirAbertoParaInscricao('ed-1')).rejects.toThrow(
      /comecam em 2026-11-10/,
    );
  });

  it('409 depois de fechar, dizendo quando fechou', async () => {
    const { service } = montarEditais({ ...EDITAL }, '2026-12-01');

    await expect(service.exigirAbertoParaInscricao('ed-1')).rejects.toThrow(
      /encerraram em 2026-11-25/,
    );
  });
});

describe('EditaisService.excluir', () => {
  /** RN10: a exclusao e logica. Nada e removido. */
  it('desativa em vez de apagar', async () => {
    const { service, instancia } = montarEditais();

    await service.excluir('ed-1');

    expect(instancia!.update).toHaveBeenCalledWith({ ativo: false });
  });

  it('e idempotente: excluir de novo nao faz nada nem falha', async () => {
    const { service, instancia } = montarEditais({ ...EDITAL, ativo: false });

    await expect(service.excluir('ed-1')).resolves.toBeUndefined();
    expect(instancia!.update).not.toHaveBeenCalled();
  });

  it('404 para edital inexistente', async () => {
    const { service } = montarEditais(null);

    await expect(service.excluir('ed-1')).rejects.toThrow(NotFoundException);
  });
});

/* ------------------------------------------------ InscricoesEditalService */

function montarInscricoes(
  opcoes: { emailAceito?: boolean; cursosDaDisciplina?: string[]; disciplinaAtiva?: boolean } = {},
) {
  const { emailAceito = true, cursosDaDisciplina = [CURSO], disciplinaAtiva = true } = opcoes;

  const criadas: Record<string, unknown>[] = [];
  const boletinsCriados: Record<string, unknown>[] = [];

  const inscricaoModel = {
    create: jest.fn().mockImplementation((dados: Record<string, unknown>) => {
      criadas.push(dados);
      return Promise.resolve({ ...dados, id: 'insc-1', createdAt: new Date() });
    }),
    findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
    findByPk: jest.fn().mockResolvedValue(null),
  };

  const boletimModel = {
    create: jest.fn().mockImplementation((dados: Record<string, unknown>) => {
      boletinsCriados.push(dados);
      return Promise.resolve(dados);
    }),
    findAll: jest.fn().mockResolvedValue([]),
    findByPk: jest.fn().mockResolvedValue(null),
  };

  const emailService = { enviar: jest.fn().mockResolvedValue(emailAceito) };

  /** O resumo por disciplina e SQL cru: o que se inspeciona e esta chamada. */
  const query = jest.fn().mockResolvedValue([]);

  let rollback = false;

  const service = new InscricoesEditalService(
    inscricaoModel as never,
    boletimModel as never,
    { findByPk: jest.fn().mockResolvedValue({ usuarioId: PROFESSOR }) } as never,
    { findAll: jest.fn().mockResolvedValue([]) } as never,
    {
      transaction: jest.fn(async (cb: (t: unknown) => unknown) => {
        try {
          return await cb({});
        } catch (erro) {
          rollback = true;
          throw erro;
        }
      }),
      query,
    } as never,
    { exigirAbertoParaInscricao: jest.fn().mockResolvedValue({ ...EDITAL }) } as never,
    { exigirAtivo: jest.fn().mockResolvedValue({ id: CURSO, nome: 'Computacao' }) } as never,
    {
      buscarOuFalhar: jest.fn().mockResolvedValue({
        id: DISCIPLINA,
        nome: 'Banco de Dados',
        ativa: disciplinaAtiva,
        cursos: cursosDaDisciplina.map((id) => ({ id })),
      }),
    } as never,
    emailService as never,
    { getOrThrow: jest.fn().mockReturnValue('https://monitoria.ufx.edu.br') } as never,
  );

  return {
    service,
    inscricaoModel,
    boletimModel,
    emailService,
    query,
    criadas,
    boletinsCriados,
    houveRollback: () => rollback,
  };
}

describe('InscricoesEditalService.criar — boletim', () => {
  it('recusa inscricao sem arquivo', async () => {
    const { service, inscricaoModel } = montarInscricoes();

    await expect(service.criar('ed-1', dadosValidos(), undefined)).rejects.toThrow(
      BadRequestException,
    );
    expect(inscricaoModel.create).not.toHaveBeenCalled();
  });

  it('recusa tipo declarado diferente de application/pdf', async () => {
    const { service } = montarInscricoes();

    await expect(
      service.criar('ed-1', dadosValidos(), arquivo({ mimetype: 'image/png' })),
    ).rejects.toThrow(/deve ser um arquivo PDF/);
  });

  /**
   * O `Content-Type` e declarado pelo cliente e nao prova nada. A assinatura
   * esta no CONTEUDO, e e o que impede gravar um executavel renomeado.
   */
  it('recusa arquivo que se declara PDF mas nao tem a assinatura', async () => {
    const { service } = montarInscricoes();

    await expect(
      service.criar('ed-1', dadosValidos(), arquivo({ buffer: Buffer.from('MZ\x90\x00binario') })),
    ).rejects.toThrow(/assinatura do formato/);
  });

  it('recusa arquivo acima do limite', async () => {
    const { service } = montarInscricoes();
    const grande = Buffer.concat([pdf(), Buffer.alloc(LIMITE_BOLETIM_BYTES)]);

    await expect(
      service.criar('ed-1', dadosValidos(), arquivo({ buffer: grande })),
    ).rejects.toThrow(/excede o limite/);
  });

  /**
   * A validacao do arquivo acontece ANTES de qualquer consulta. Ele e a unica
   * parte da requisicao que ja esta inteira em memoria, e recusar sem tocar no
   * banco e o que impede uma rota publica de virar gerador de carga.
   */
  it('valida o arquivo antes de consultar o edital', async () => {
    const { service } = montarInscricoes();
    const editaisService = (
      service as never as { editaisService: { exigirAbertoParaInscricao: jest.Mock } }
    ).editaisService;

    await expect(service.criar('ed-1', dadosValidos(), undefined)).rejects.toThrow(
      BadRequestException,
    );

    expect(editaisService.exigirAbertoParaInscricao).not.toHaveBeenCalled();
  });

  it('grava tamanho e sha256 do conteudo recebido', async () => {
    const { service, boletinsCriados } = montarInscricoes();

    await service.criar('ed-1', dadosValidos(), arquivo());

    expect(boletinsCriados[0].tamanhoBytes).toBe(pdf().length);
    expect(boletinsCriados[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sanitiza o nome do arquivo antes de gravar', async () => {
    const { service, boletinsCriados } = montarInscricoes();

    await service.criar('ed-1', dadosValidos(), arquivo({ originalname: '../a"b.pdf' }));

    expect(boletinsCriados[0].nomeOriginal).not.toContain('..');
    expect(boletinsCriados[0].nomeOriginal).not.toContain('"');
  });
});

describe('InscricoesEditalService.criar — notas e media', () => {
  /**
   * A afirmacao mais importante do modulo: o service NUNCA menciona `media`.
   *
   * No banco ela e GENERATED ALWAYS e o PostgreSQL recusa INSERT que a cite —
   * mas a garantia so vale se o codigo tambem nao tentar. Se alguem acrescentar
   * `media` ao create no futuro, a inscricao passa a falhar em producao com
   * erro de driver; este teste pega isso antes.
   */
  it('nao envia `media` no INSERT', async () => {
    const { service, criadas } = montarInscricoes();

    await service.criar('ed-1', dadosValidos({ n1: 8.5, n2: 9.25 }), arquivo());

    expect(Object.keys(criadas[0])).not.toContain('media');
    expect(criadas[0].n1).toBe(8.5);
    expect(criadas[0].n2).toBe(9.25);
  });

  it('nota ausente vai como NULL, nao como zero', async () => {
    const { service, criadas } = montarInscricoes();

    await service.criar('ed-1', dadosValidos({ n1: 7 }), arquivo());

    expect(criadas[0].n1).toBe(7);
    expect(criadas[0].n2).toBeNull();
  });

  it('zero informado de proposito e preservado', async () => {
    const { service, criadas } = montarInscricoes();

    await service.criar('ed-1', dadosValidos({ n1: 0, n2: 0 }), arquivo());

    expect(criadas[0].n1).toBe(0);
    expect(criadas[0].n2).toBe(0);
  });

  /** A confirmacao publica nao devolve nota, media nem metadado do arquivo. */
  it('a resposta publica e minima', async () => {
    const { service } = montarInscricoes();

    const resposta = await service.criar('ed-1', dadosValidos({ n1: 8.5, n2: 9 }), arquivo());

    expect(Object.keys(resposta).sort()).toEqual([
      'criadoEm',
      'editalId',
      'emailConfirmacaoEnviado',
      'id',
      'nomeCompleto',
    ]);
  });
});

describe('InscricoesEditalService.criar — curso e disciplina', () => {
  it('recusa disciplina que o curso nao oferece', async () => {
    const { service, inscricaoModel } = montarInscricoes({ cursosDaDisciplina: ['outro-curso'] });

    await expect(service.criar('ed-1', dadosValidos(), arquivo())).rejects.toThrow(
      /nao e oferecida pelo curso/,
    );
    expect(inscricaoModel.create).not.toHaveBeenCalled();
  });

  it('recusa disciplina inativa', async () => {
    const { service } = montarInscricoes({ disciplinaAtiva: false });

    await expect(service.criar('ed-1', dadosValidos(), arquivo())).rejects.toThrow(/esta inativa/);
  });

  it('aceita quando a disciplina e oferecida por varios cursos, incluindo o informado', async () => {
    const { service, criadas } = montarInscricoes({ cursosDaDisciplina: ['outro', CURSO] });

    await service.criar('ed-1', dadosValidos(), arquivo());

    expect(criadas[0].cursoId).toBe(CURSO);
  });
});

describe('InscricoesEditalService.criar — e-mail de confirmacao', () => {
  /**
   * O inverso da escolha feita na criacao de usuario, onde falha de envio
   * desfaz a operacao. La o e-mail ENTREGA a credencial e a conta nasce
   * inutilizavel sem ele; aqui ele apenas CONFIRMA um fato ja gravado. Apagar
   * a candidatura porque o provedor esta fora puniria o candidato por um
   * problema nosso, e o prazo do edital pode nem permitir nova tentativa.
   */
  it('falha de envio NAO desfaz a inscricao', async () => {
    const { service, inscricaoModel, houveRollback } = montarInscricoes({ emailAceito: false });

    const resposta = await service.criar('ed-1', dadosValidos(), arquivo());

    expect(resposta.id).toBe('insc-1');
    expect(resposta.emailConfirmacaoEnviado).toBe(false);
    expect(inscricaoModel.create).toHaveBeenCalledTimes(1);
    expect(houveRollback()).toBe(false);
  });

  it('o envio acontece DEPOIS da transacao', async () => {
    const ordem: string[] = [];
    const { service, inscricaoModel, emailService } = montarInscricoes();

    inscricaoModel.create.mockImplementation(() => {
      ordem.push('insert');
      return Promise.resolve({
        id: 'insc-1',
        editalId: 'ed-1',
        nomeCompleto: 'x',
        createdAt: new Date(),
      });
    });
    emailService.enviar.mockImplementation(() => {
      ordem.push('email');
      return Promise.resolve(true);
    });

    await service.criar('ed-1', dadosValidos(), arquivo());

    expect(ordem).toEqual(['insert', 'email']);
  });

  it('a mensagem leva o identificador da inscricao e o link do edital', async () => {
    const { service, emailService } = montarInscricoes();

    await service.criar('ed-1', dadosValidos(), arquivo());

    const [mensagem] = emailService.enviar.mock.calls[0];

    expect(mensagem.texto).toContain('insc-1');
    expect(mensagem.texto).toContain(EDITAL.link);
    expect(mensagem.para[0].email).toBe('maria@ufx.edu.br');
  });

  /** Um unico e-mail por candidatura: nao ha reenvio nem outbox neste caminho. */
  it('envia exatamente um e-mail', async () => {
    const { service, emailService } = montarInscricoes();

    await service.criar('ed-1', dadosValidos(), arquivo());

    expect(emailService.enviar).toHaveBeenCalledTimes(1);
  });
});

describe('InscricoesEditalService.listar — ordenacao e privacidade', () => {
  async function ordenacaoDe(ordenarPor: CampoOrdenacaoInscricao, direcao: DirecaoOrdenacao) {
    const { service, inscricaoModel } = montarInscricoes();

    await service.listar({
      pagina: 1,
      limite: 20,
      offset: 0,
      ordenarPor,
      direcao,
    } as never);

    const [opcoes] = inscricaoModel.findAndCountAll.mock.calls[0];
    return opcoes.order as [{ col: string }, string][];
  }

  /**
   * NULLS LAST nas DUAS direcoes, e nao so na descendente.
   *
   * O padrao do PostgreSQL e NULLS FIRST em DESC: sem isto, ordenar por media
   * decrescente colocaria o candidato SEM nota como primeiro colocado. Fixar
   * nos dois casos evita que a lista afirme coisas diferentes conforme a
   * direcao.
   */
  it.each([
    [DirecaoOrdenacao.DESC, 'DESC NULLS LAST'],
    [DirecaoOrdenacao.ASC, 'ASC NULLS LAST'],
  ])('%s usa %s', async (direcao, esperado) => {
    const order = await ordenacaoDe(CampoOrdenacaoInscricao.MEDIA, direcao as DirecaoOrdenacao);

    expect(order[0][1]).toBe(esperado);
  });

  /**
   * A coluna vem de um mapa fechado e qualificada pelo alias da tabela: com
   * JOINs, um `created_at` solto e ambiguo para o PostgreSQL.
   */
  it.each([
    [CampoOrdenacaoInscricao.MEDIA, 'InscricaoEdital.media'],
    [CampoOrdenacaoInscricao.N1, 'InscricaoEdital.n1'],
    [CampoOrdenacaoInscricao.N2, 'InscricaoEdital.n2'],
    [CampoOrdenacaoInscricao.NOME, 'InscricaoEdital.nome_completo'],
    [CampoOrdenacaoInscricao.MATRICULA, 'InscricaoEdital.matricula'],
    [CampoOrdenacaoInscricao.CRIADO_EM, 'InscricaoEdital.created_at'],
  ])('%s -> %s', async (campo, coluna) => {
    const order = await ordenacaoDe(campo as CampoOrdenacaoInscricao, DirecaoOrdenacao.DESC);

    expect(order[0][0].col).toBe(coluna);
  });

  /** `id` desempata: sem ele, medias iguais trocam de lugar entre paginas. */
  it('desempata por id', async () => {
    const order = await ordenacaoDe(CampoOrdenacaoInscricao.MEDIA, DirecaoOrdenacao.DESC);

    expect(order[1][0].col).toBe('InscricaoEdital.id');
    expect(order[1][1]).toBe('ASC');
  });

  /**
   * A consulta principal nao toca a tabela do binario, e a consulta de
   * metadado enumera as colunas. As duas coisas juntas sao o que mantem o PDF
   * fora de toda resposta de listagem.
   */
  it('a listagem nunca seleciona `conteudo`', async () => {
    const { service, inscricaoModel, boletimModel } = montarInscricoes();

    inscricaoModel.findAndCountAll.mockResolvedValue({
      rows: [
        {
          id: 'insc-1',
          matricula: '2021001234',
          nomeCompleto: 'Maria',
          email: 'maria@ufx.edu.br',
          turno: Turno.NOTURNO,
          n1: '8.50',
          n2: '9.25',
          media: '8.88',
          editalId: 'ed-1',
          cursoId: CURSO,
          disciplinaId: DISCIPLINA,
          professorId: PROFESSOR,
          createdAt: new Date(),
        },
      ],
      count: 1,
    });

    await service.listar({ pagina: 1, limite: 20, offset: 0 } as never);

    const [principal] = inscricaoModel.findAndCountAll.mock.calls[0];
    const [metadado] = boletimModel.findAll.mock.calls[0];

    expect(JSON.stringify(principal.include)).not.toContain('Boletim');
    expect(metadado.attributes).toEqual(['inscricaoId', 'nomeOriginal', 'tamanhoBytes', 'sha256']);
    expect(metadado.attributes).not.toContain('conteudo');
  });

  it('busca cobre nome, matricula e e-mail de uma vez', async () => {
    const { service, inscricaoModel } = montarInscricoes();

    await service.listar({ pagina: 1, limite: 20, offset: 0, busca: 'maria' } as never);

    const [opcoes] = inscricaoModel.findAndCountAll.mock.calls[0];

    /**
     * Indexado pelo SIMBOLO, nao por `Object.values`.
     *
     * `Op.or` e um Symbol: ele nao aparece em `Object.keys`, `Object.values`
     * nem em `JSON.stringify`. Um teste que inspecionasse o `where` por essas
     * vias veria `{}` e passaria mesmo se o filtro tivesse sido esquecido.
     */
    const alternativas = (opcoes.where as Record<symbol, Record<string, unknown>[]>)[Op.or];
    const campos = alternativas.map((alternativa) => Object.keys(alternativa)[0]);

    expect(campos.sort()).toEqual(['email', 'matricula', 'nomeCompleto']);
  });

  /** `ano` e `semestre` sao do EDITAL: filtram pelo include, nao pela inscricao. */
  it('ano e semestre filtram o edital pelo JOIN obrigatorio', async () => {
    const { service, inscricaoModel } = montarInscricoes();

    await service.listar({ pagina: 1, limite: 20, offset: 0, ano: 2026, semestre: 2 } as never);

    const [opcoes] = inscricaoModel.findAndCountAll.mock.calls[0];
    const doEdital = (opcoes.include as { where?: unknown; required?: boolean }[]).find(
      (item) => item.where,
    );

    expect(doEdital).toMatchObject({ where: { ano: 2026, semestre: 2 }, required: true });
    expect(opcoes.where).not.toHaveProperty('ano');
  });
});

describe('InscricoesEditalService.resumoPorDisciplina', () => {
  /** O SQL e um literal do codigo; o que vem do cliente sai por replacements. */
  function sqlEValores(query: jest.Mock) {
    const [sql, opcoes] = query.mock.calls[0];
    return { sql: sql as string, valores: (opcoes as { replacements: object }).replacements };
  }

  const linha = {
    disciplina_id: DISCIPLINA,
    disciplina_codigo: 'BAN001',
    disciplina_nome: 'Banco de Dados',
    total_inscricoes: '7',
    com_media: '5',
    melhor_media: '8.85',
    /** `ARRAY_AGG(DISTINCT i.edital_id)` da consulta agregada. */
    editais: ['ed-1'],
  };

  /**
   * O resumo faz DUAS consultas: a agregada e a que procura a monitoria vinda
   * do edital. Encadear `mockResolvedValueOnce` mantem as duas distinguiveis —
   * um `mockResolvedValue` unico faria a segunda receber as linhas da primeira
   * e os testes passariam lendo campos que nao existem.
   */
  function responderCom(
    query: jest.Mock,
    agregada: Record<string, unknown>[],
    monitorias: Record<string, unknown>[] = [],
  ) {
    query.mockResolvedValueOnce(agregada).mockResolvedValueOnce(monitorias);
  }

  it('agrupa por disciplina e ordena pelo nome', async () => {
    const { service, query } = montarInscricoes();

    await service.resumoPorDisciplina({} as never);

    const { sql } = sqlEValores(query);

    expect(sql).toContain('GROUP BY d.id, d.codigo, d.nome');
    expect(sql).toContain('ORDER BY d.nome ASC');
  });

  /**
   * `COUNT(i.media)` e `MAX(i.media)` ignoram nulos — e e assim que "quantos
   * dao para ranquear" e "melhor media" saem certos sem nenhum `if`.
   */
  it('conta a media pelos nao nulos e nao inventa zero', async () => {
    const { service, query } = montarInscricoes();

    await service.resumoPorDisciplina({} as never);

    const { sql } = sqlEValores(query);

    expect(sql).toContain('COUNT(i.media)');
    expect(sql).toContain('MAX(i.media)');
  });

  it('sem filtro, nao emite WHERE', async () => {
    const { service, query } = montarInscricoes();

    await service.resumoPorDisciplina({} as never);

    const { sql, valores } = sqlEValores(query);

    expect(sql).not.toContain('WHERE');
    expect(valores).toEqual({});
  });

  /**
   * A afirmacao de seguranca: o valor do cliente NUNCA entra no texto da
   * consulta. Se alguem trocar `:editalId` por interpolacao, o id aparece no
   * SQL e este teste falha.
   */
  it('passa os valores por replacements, nunca interpolados no SQL', async () => {
    const { service, query } = montarInscricoes();

    await service.resumoPorDisciplina({
      editalId: 'ed-1',
      cursoId: CURSO,
      disciplinaId: DISCIPLINA,
      turno: Turno.NOTURNO,
      professorId: PROFESSOR,
      busca: "x'; DROP TABLE inscricoes_edital; --",
      ano: 2026,
      semestre: 2,
    } as never);

    const { sql, valores } = sqlEValores(query);

    expect(sql).not.toContain('ed-1');
    expect(sql).not.toContain('DROP TABLE');
    expect(valores).toEqual({
      editalId: 'ed-1',
      cursoId: CURSO,
      disciplinaId: DISCIPLINA,
      turno: Turno.NOTURNO,
      professorId: PROFESSOR,
      busca: "%x'; DROP TABLE inscricoes_edital; --%",
      ano: 2026,
      semestre: 2,
    });
  });

  /**
   * O resumo e o cabecalho de uma lista que o cliente abre depois. Se ele
   * ignorasse um filtro que a listagem aplica, o total mostrado seria maior que
   * o conteudo do grupo — e o cabecalho seria o mentiroso.
   */
  it('aplica os MESMOS filtros da listagem plana', async () => {
    const { service, query } = montarInscricoes();

    await service.resumoPorDisciplina({
      editalId: 'ed-1',
      cursoId: CURSO,
      disciplinaId: DISCIPLINA,
      turno: Turno.MATUTINO,
      professorId: PROFESSOR,
      busca: 'maria',
      ano: 2026,
      semestre: 2,
    } as never);

    const { sql } = sqlEValores(query);

    for (const condicao of [
      'i.edital_id = :editalId',
      'i.curso_id = :cursoId',
      'i.disciplina_id = :disciplinaId',
      'i.turno = :turno',
      'i.professor_id = :professorId',
      'e.ano = :ano',
      'e.semestre = :semestre',
    ]) {
      expect(sql).toContain(condicao);
    }

    expect(sql).toContain(
      '(i.nome_completo ILIKE :busca OR i.matricula ILIKE :busca OR i.email ILIKE :busca)',
    );
  });

  /** `ano` e `semestre` sao do EDITAL: exigem o JOIN, que entra sempre. */
  it('junta editais mesmo sem filtro de periodo, para a consulta ter uma forma so', async () => {
    const { service, query } = montarInscricoes();

    await service.resumoPorDisciplina({ editalId: 'ed-1' } as never);

    expect(sqlEValores(query).sql).toContain('JOIN editais e');
  });

  it('converte os agregados e deriva semMedia', async () => {
    const { service, query } = montarInscricoes();
    responderCom(query, [linha]);

    const [resumo] = await service.resumoPorDisciplina({} as never);

    expect(resumo).toEqual({
      disciplina: { id: DISCIPLINA, codigo: 'BAN001', nome: 'Banco de Dados' },
      totalInscricoes: 7,
      comMedia: 5,
      semMedia: 2,
      melhorMedia: 8.85,
      monitoriaCadastrada: false,
      monitoriaId: null,
      monitoresHabilitados: 0,
    });
  });

  /** Ninguem com nota na disciplina: melhor media e NULA, nunca zero. */
  it('melhorMedia nula quando nenhum candidato tem media', async () => {
    const { service, query } = montarInscricoes();
    responderCom(query, [{ ...linha, total_inscricoes: '3', com_media: '0', melhor_media: null }]);

    const [resumo] = await service.resumoPorDisciplina({} as never);

    expect(resumo.melhorMedia).toBeNull();
    expect(resumo.melhorMedia).not.toBe(0);
    expect(resumo.semMedia).toBe(3);
  });

  /**
   * O flag que a tela usa para marcar o grupo como concluido exige as DUAS
   * coisas: monitoria vinda do edital E monitor habilitado nela.
   */
  it('marca a disciplina como cadastrada quando ha monitoria COM monitor', async () => {
    const { service, query } = montarInscricoes();
    responderCom(
      query,
      [linha],
      [{ disciplina_id: DISCIPLINA, monitoria_id: 'mon-1', monitores: 2 }],
    );

    const [resumo] = await service.resumoPorDisciplina({ editalId: 'ed-1' } as never);

    expect(resumo.monitoriaCadastrada).toBe(true);
    expect(resumo.monitoriaId).toBe('mon-1');
    expect(resumo.monitoresHabilitados).toBe(2);
  });

  /**
   * Monitoria criada e monitor pendente e o estado parcial que uma aprovacao
   * interrompida deixa. NAO pode contar como resolvido: e justamente o grupo
   * que precisa de atencao, e `monitoriaId` preenchido permite a tela dizer
   * "retome esta".
   */
  it('monitoria SEM monitor nao conta como cadastrada', async () => {
    const { service, query } = montarInscricoes();
    responderCom(
      query,
      [linha],
      [{ disciplina_id: DISCIPLINA, monitoria_id: 'mon-1', monitores: 0 }],
    );

    const [resumo] = await service.resumoPorDisciplina({ editalId: 'ed-1' } as never);

    expect(resumo.monitoriaCadastrada).toBe(false);
    expect(resumo.monitoriaId).toBe('mon-1');
    expect(resumo.monitoresHabilitados).toBe(0);
  });

  it('disciplina sem monitoria vem com os tres campos zerados', async () => {
    const { service, query } = montarInscricoes();
    responderCom(query, [linha], []);

    const [resumo] = await service.resumoPorDisciplina({ editalId: 'ed-1' } as never);

    expect(resumo.monitoriaCadastrada).toBe(false);
    expect(resumo.monitoriaId).toBeNull();
    expect(resumo.monitoresHabilitados).toBe(0);
  });

  /**
   * A procura e restrita a monitorias VINDAS de edital. Sem isto, uma monitoria
   * que o professor abriu a mao acenderia a marca de "resolvida pelo edital".
   */
  it('procura so monitorias com edital_id, nos editais do recorte', async () => {
    const { service, query } = montarInscricoes();
    responderCom(query, [linha]);

    await service.resumoPorDisciplina({ editalId: 'ed-1' } as never);

    const [sql, opcoes] = query.mock.calls[1];

    expect(sql).toContain('m.edital_id IS NOT NULL');
    expect(sql).toContain('m.edital_id IN (:editais)');
    expect(sql).toContain("mp.papel = 'MONITOR' AND mp.status = 'ATIVO'");
    expect((opcoes as { replacements: object }).replacements).toEqual({
      editais: ['ed-1'],
      disciplinas: [DISCIPLINA],
    });
  });

  /**
   * Juntar monitorias na consulta AGREGADA multiplicaria as inscricoes por
   * monitor e inflaria `total_inscricoes` — erro silencioso, que nada faria
   * falhar. Por isso sao duas consultas, e a primeira nao menciona as tabelas
   * de monitoria.
   */
  it('a consulta agregada nao junta monitorias', async () => {
    const { service, query } = montarInscricoes();
    responderCom(query, [linha]);

    await service.resumoPorDisciplina({ editalId: 'ed-1' } as never);

    const [sqlAgregada] = query.mock.calls[0];

    expect(sqlAgregada).not.toContain('monitoria_participantes');
    expect(sqlAgregada).not.toContain('JOIN monitorias');
  });

  /** Nada a procurar: a segunda consulta nem sai. */
  it('nao faz a segunda consulta quando nao ha grupo', async () => {
    const { service, query } = montarInscricoes();
    responderCom(query, []);

    await service.resumoPorDisciplina({ editalId: 'ed-1' } as never);

    expect(query).toHaveBeenCalledTimes(1);
  });

  /**
   * `uq_monitoria_oferta` permite duas monitorias da mesma disciplina no mesmo
   * periodo quando os professores diferem. Entre elas, a que descreve o estado
   * do grupo e a que JA tem monitor — mostrar "pendente" com um monitor
   * habilitado em outra seria falso.
   */
  it('havendo duas monitorias da disciplina, prefere a que tem monitor', async () => {
    const { service, query } = montarInscricoes();
    responderCom(
      query,
      [linha],
      [
        { disciplina_id: DISCIPLINA, monitoria_id: 'com-monitor', monitores: 1 },
        { disciplina_id: DISCIPLINA, monitoria_id: 'sem-monitor', monitores: 0 },
      ],
    );

    const [resumo] = await service.resumoPorDisciplina({ editalId: 'ed-1' } as never);

    expect(resumo.monitoriaId).toBe('com-monitor');
    expect(resumo.monitoriaCadastrada).toBe(true);
  });

  it('recorte sem candidatura devolve lista vazia, nao erro', async () => {
    const { service } = montarInscricoes();

    await expect(service.resumoPorDisciplina({ editalId: 'ed-1' } as never)).resolves.toEqual([]);
  });

  /**
   * O resumo nao toca a tabela do binario. Ele conta candidaturas; o PDF tem
   * rota propria e nao deve aparecer em consulta agregada nenhuma.
   */
  it('nao consulta boletins', async () => {
    const { service, query, boletimModel } = montarInscricoes();

    await service.resumoPorDisciplina({ editalId: 'ed-1' } as never);

    expect(boletimModel.findAll).not.toHaveBeenCalled();
    expect(sqlEValores(query).sql).not.toContain('boletins');
  });
});

describe('InscricoesEditalService.conteudoDoBoletim', () => {
  it('404 quando nao existe boletim para a inscricao', async () => {
    const { service } = montarInscricoes();

    await expect(service.conteudoDoBoletim('insc-1')).rejects.toThrow(NotFoundException);
  });

  it('devolve o conteudo quando existe', async () => {
    const { service, boletimModel } = montarInscricoes();

    boletimModel.findByPk.mockResolvedValue({ conteudo: pdf(), nomeOriginal: 'b.pdf' });

    await expect(service.conteudoDoBoletim('insc-1')).resolves.toMatchObject({
      nomeOriginal: 'b.pdf',
    });
  });
});

describe('InscricoesEditalService.detalhar', () => {
  it('404 quando a inscricao nao existe', async () => {
    const { service } = montarInscricoes();

    await expect(service.detalhar('insc-1')).rejects.toThrow(NotFoundException);
  });
});
