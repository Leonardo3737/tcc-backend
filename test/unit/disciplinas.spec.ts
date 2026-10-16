import { ConflictException } from '@nestjs/common';
import { Op, UniqueConstraintError } from 'sequelize';

import { DisciplinasService } from '../../src/modules/disciplinas/disciplinas.service';
import { prefixoDoNome, proximoCodigo } from '../../src/common/gerador-de-codigo';

/**
 * O codigo da disciplina passou a ser gerado pelo servidor.
 *
 * A exigencia e simples de enunciar e facil de quebrar em silencio: nunca
 * repetir. Estes testes cobrem as duas metades disso — a geracao em si
 * (funcoes puras) e o comportamento sob colisao, que e onde a unicidade
 * realmente se decide.
 */

describe('prefixoDoNome', () => {
  it.each([
    ['Calculo I', 'CAL'],
    ['Algebra Linear', 'ALG'],
    ['Estrutura de Dados', 'EST'],
  ])('%s -> %s', (nome, esperado) => {
    expect(prefixoDoNome(nome)).toBe(esperado);
  });

  /**
   * O mesmo nome digitado com e sem acento precisa cair no mesmo prefixo,
   * senao "Algebra" e "Álgebra" viram familias de codigo diferentes.
   */
  it('ignora acentuacao', () => {
    expect(prefixoDoNome('Álgebra Linear')).toBe(prefixoDoNome('Algebra Linear'));
    expect(prefixoDoNome('Cálculo I')).toBe('CAL');
    expect(prefixoDoNome('Introdução à Computação')).toBe('INT');
  });

  it('ignora espacos, numeros e pontuacao', () => {
    expect(prefixoDoNome('  Fisica 2  ')).toBe('FIS');
    expect(prefixoDoNome('P.O.O.')).toBe('POO');
  });

  it('completa nomes curtos para manter a largura fixa', () => {
    expect(prefixoDoNome('IA')).toBe('IAX');
    expect(prefixoDoNome('C')).toBe('CXX');
  });

  it('cai no prefixo padrao quando nao ha letra nenhuma', () => {
    expect(prefixoDoNome('101')).toBe('DIS');
    expect(prefixoDoNome('--')).toBe('DIS');
  });
});

describe('proximoCodigo', () => {
  it('comeca em 001 quando o prefixo e novo', () => {
    expect(proximoCodigo('CAL', [])).toBe('CAL001');
  });

  it('continua a partir do maior numero existente', () => {
    expect(proximoCodigo('CAL', ['CAL001', 'CAL002'])).toBe('CAL003');
  });

  /** Buracos na sequencia nao devem reaproveitar numero ja usado. */
  it('nao preenche buracos', () => {
    expect(proximoCodigo('CAL', ['CAL001', 'CAL007'])).toBe('CAL008');
  });

  it('ignora a ordem em que os codigos chegam', () => {
    expect(proximoCodigo('CAL', ['CAL010', 'CAL002', 'CAL007'])).toBe('CAL011');
  });

  /**
   * `codigo` e CITEXT: para o banco, cal001 e CAL001 sao o mesmo codigo. Se a
   * contagem fosse sensivel a caixa, geraria um codigo que a constraint recusa.
   */
  it('conta codigos em qualquer caixa', () => {
    expect(proximoCodigo('CAL', ['cal001', 'Cal002'])).toBe('CAL003');
  });

  /**
   * Codigos do tempo em que o campo era digitado continuam no banco. Eles nao
   * entram na numeracao, mas tambem nao podem derruba-la.
   */
  it('ignora codigos legados de formato livre', () => {
    expect(proximoCodigo('CAL', ['CALCULO-1', 'CAL-A', 'CAL001'])).toBe('CAL002');
  });

  it('passa de 999 ocupando mais digitos, sem reiniciar', () => {
    expect(proximoCodigo('CAL', ['CAL999'])).toBe('CAL1000');
    expect(proximoCodigo('CAL', ['CAL1000'])).toBe('CAL1001');
  });

  /**
   * Caso real encontrado no banco de desenvolvimento: ja existia FIS0110,
   * digitado a mao quando o campo era livre. Sem acompanhar a largura, o
   * proximo sairia FIS111 — unico, mas deixando a familia com dois formatos.
   */
  it('acompanha a largura ja usada no prefixo', () => {
    expect(proximoCodigo('FIS', ['FIS0110'])).toBe('FIS0111');
    expect(proximoCodigo('MAT', ['MAT00042'])).toBe('MAT00043');
  });

  it('a largura minima continua 3, mesmo com codigos mais curtos', () => {
    expect(proximoCodigo('CAL', ['CAL1', 'CAL2'])).toBe('CAL003');
  });
});

/** Curso usado em todas as criacoes destes testes. */
const CURSO = '11111111-1111-4111-8111-000000000009';

/** Erro que o Postgres levanta quando o codigo gerado ja existe. */
function colisao() {
  return new UniqueConstraintError({ errors: [] });
}

function montar(comportamento: { existentes?: string[]; falhasSeguidas?: number } = {}) {
  const { existentes = [], falhasSeguidas = 0 } = comportamento;

  let tentativas = 0;
  const criados: { codigo: string; nome: string }[] = [];

  const disciplinaModel = {
    findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
    findAll: jest.fn().mockImplementation(() =>
      Promise.resolve(
        // Cada criacao bem-sucedida passa a ser enxergada pela consulta
        // seguinte, como aconteceria no banco.
        [...existentes, ...criados.map((d) => d.codigo)].map((codigo) => ({ codigo })),
      ),
    ),
    create: jest.fn().mockImplementation((dados: { codigo: string; nome: string }) => {
      tentativas += 1;

      if (tentativas <= falhasSeguidas) {
        return Promise.reject(colisao());
      }

      criados.push(dados);
      return Promise.resolve({
        id: 'd-1',
        ativa: true,
        createdAt: new Date(),
        cursos: [{ id: CURSO, codigo: 'CUR001', nome: 'Curso' }],
        reload: jest.fn().mockResolvedValue(undefined),
        ...dados,
      });
    }),
  };

  const disciplinaCursoModel = {
    bulkCreate: jest.fn().mockResolvedValue([]),
    findAll: jest.fn().mockResolvedValue([]),
    destroy: jest.fn().mockResolvedValue(0),
  };

  const cursosService = {
    exigirAtivo: jest.fn().mockResolvedValue({ id: CURSO, nome: 'Curso', ativo: true }),
  };

  return {
    service: new DisciplinasService(
      disciplinaModel as never,
      disciplinaCursoModel as never,
      {
        // A criacao abre transacao; o dublê executa o callback direto.
        transaction: jest.fn((cb: (t: unknown) => unknown) => cb({})),
        // `literal` devolve o proprio SQL, para o teste poder inspeciona-lo.
        literal: jest.fn((sql: string) => sql),
      } as never,
      cursosService as never,
    ),
    disciplinaModel,
    disciplinaCursoModel,
    cursosService,
    criados,
  };
}

describe('DisciplinasService.criar', () => {
  it('gera o codigo a partir do nome, sem receber nada', async () => {
    const { service, criados } = montar();

    const resposta = await service.criar({ nome: 'Calculo I', cursosIds: [CURSO] });

    expect(criados[0].codigo).toBe('CAL001');
    expect(resposta.codigo).toBe('CAL001');
  });

  /** O caso que mais ameaca a unicidade: prefixo identico. */
  it('numera disciplinas de mesmo nome em sequencia', async () => {
    const { service, criados } = montar();

    await service.criar({ nome: 'Calculo I', cursosIds: [CURSO] });
    await service.criar({ nome: 'Calculo I', cursosIds: [CURSO] });
    await service.criar({ nome: 'Calculo I', cursosIds: [CURSO] });

    expect(criados.map((d) => d.codigo)).toEqual(['CAL001', 'CAL002', 'CAL003']);
  });

  it('consulta apenas os codigos do mesmo prefixo', async () => {
    const { service, disciplinaModel } = montar();

    await service.criar({ nome: 'Fisica', cursosIds: [CURSO] });

    const [opcoes] = disciplinaModel.findAll.mock.calls[0];

    // `Op.iLike` e um Symbol: JSON.stringify e Object.values nao o enxergam.
    expect(opcoes.where.codigo[Op.iLike]).toBe('FIS%');
  });

  /**
   * A corrida real: duas criacoes calculam CAL001 ao mesmo tempo, uma perde
   * para a constraint UNIQUE. A perdedora precisa recalcular — nao falhar.
   */
  it('tenta de novo quando a constraint recusa o codigo', async () => {
    const { service, disciplinaModel } = montar({ falhasSeguidas: 1 });

    const resposta = await service.criar({ nome: 'Calculo I', cursosIds: [CURSO] });

    expect(disciplinaModel.create).toHaveBeenCalledTimes(2);
    expect(resposta.codigo).toBe('CAL001');
  });

  it('desiste com 409 se a colisao persistir', async () => {
    const { service } = montar({ falhasSeguidas: 99 });

    await expect(service.criar({ nome: 'Calculo I', cursosIds: [CURSO] })).rejects.toThrow(
      ConflictException,
    );
  });

  /**
   * Repetir a insercao so faz sentido para colisao de codigo. Com qualquer
   * outro erro, o laco viraria tentativa inutil contra um banco com problema.
   */
  it('nao tenta de novo quando o erro e outro', async () => {
    const { service, disciplinaModel } = montar();
    disciplinaModel.create.mockRejectedValue(new Error('conexao perdida'));

    await expect(service.criar({ nome: 'Calculo I', cursosIds: [CURSO] })).rejects.toThrow(
      'conexao perdida',
    );
    expect(disciplinaModel.create).toHaveBeenCalledTimes(1);
  });

  it('continua a numeracao a partir do que ja existe no banco', async () => {
    const { service, criados } = montar({ existentes: ['CAL001', 'CAL002'] });

    await service.criar({ nome: 'Calculo I', cursosIds: [CURSO] });

    expect(criados[0].codigo).toBe('CAL003');
  });
});

describe('Filtro de disciplinas por curso', () => {
  it('restringe por subconsulta, nao por where no include', async () => {
    const { service, disciplinaModel } = montar();

    await service.listar({ cursoId: CURSO, pagina: 1, limite: 20, offset: 0 } as never);

    const [opcoes] = disciplinaModel.findAndCountAll.mock.calls[0];

    /**
     * O include NAO pode ter `where`: isso transformaria o join em INNER e
     * faria cada disciplina voltar so com o curso filtrado — a resposta
     * afirmaria que Banco de Dados pertence a um curso so.
     */
    expect(opcoes.include.some((i: unknown) => typeof i === 'object' && i && 'where' in i)).toBe(
      false,
    );

    expect(String(opcoes.where.id[Op.in])).toContain('disciplina_cursos');
    expect(opcoes.replacements.cursoFiltrado).toBe(CURSO);
  });

  it('sem o filtro, nao restringe por id', async () => {
    const { service, disciplinaModel } = montar();

    await service.listar({ pagina: 1, limite: 20, offset: 0 } as never);

    expect(disciplinaModel.findAndCountAll.mock.calls[0][0].where.id).toBeUndefined();
  });
});

describe('Disciplina em varios cursos', () => {
  it('grava uma associacao por curso informado', async () => {
    const { service, disciplinaCursoModel } = montar();
    const outro = '33333333-3333-4333-8333-000000000009';

    await service.criar({ nome: 'Banco de Dados', cursosIds: [CURSO, outro] });

    const [linhas] = disciplinaCursoModel.bulkCreate.mock.calls[0];
    expect(linhas.map((l: { cursoId: string }) => l.cursoId)).toEqual([CURSO, outro]);
  });

  /** Mandar o mesmo curso duas vezes violaria a PK composta da associacao. */
  it('ignora cursos repetidos no corpo', async () => {
    const { service, disciplinaCursoModel } = montar();

    await service.criar({ nome: 'Banco de Dados', cursosIds: [CURSO, CURSO] });

    expect(disciplinaCursoModel.bulkCreate.mock.calls[0][0]).toHaveLength(1);
  });

  it('valida cada curso antes de inserir', async () => {
    const { service, cursosService } = montar();
    const outro = '33333333-3333-4333-8333-000000000009';

    await service.criar({ nome: 'Banco de Dados', cursosIds: [CURSO, outro] });

    expect(cursosService.exigirAtivo).toHaveBeenCalledWith(CURSO);
    expect(cursosService.exigirAtivo).toHaveBeenCalledWith(outro);
  });
});
