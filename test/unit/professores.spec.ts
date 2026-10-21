import { Op } from 'sequelize';

import { UsuariosService } from '../../src/modules/usuarios/usuarios.service';

/**
 * Busca na listagem de professores — e a assimetria entre as duas rotas.
 *
 * O caso de teste que importa aqui nao e "a busca funciona": e que a rota
 * PUBLICA busca por MENOS campos que a autenticada. `ProfessorPublicoDto` omite
 * o e-mail para nao entregar enderecos a um anonimo, e aceitar e-mail no filtro
 * desfaria isso pelo outro lado — quem digitasse `fulano@ufx.edu.br` descobriria,
 * pelo acerto ou pelo vazio, se o endereco e de um docente. O dado nao sairia na
 * resposta, mas a resposta o confirmaria.
 *
 * Um vazamento desse tipo nao quebra teste nenhum e nao aparece em revisao de
 * diff: e so uma string a mais em uma lista. Por isso ele e afirmado
 * explicitamente, pelo nome do campo.
 */

/**
 * `professorModel` e o TERCEIRO parametro do construtor. Os demais sao preenchidos
 * com dubles vazios porque nenhuma destas consultas os alcanca.
 */
function montar() {
  const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });

  return {
    service: new UsuariosService(
      {} as never,
      {} as never,
      { findAndCountAll } as never,
      {} as never,
      {} as never,
      {} as never,
      { get: () => [] } as never,
      {} as never,
      {} as never,
    ),
    findAndCountAll,
  };
}

const paginacao = { pagina: 1, limite: 20, offset: 0 };

/** Nomes dos campos varridos pelo OR, na ordem em que foram montados. */
function camposBuscados(findAndCountAll: jest.Mock): string[] {
  // `Op.or` e `Op.iLike` sao Symbols: nao aparecem em Object.keys nem em
  // JSON.stringify. Indexar pelo simbolo e a unica leitura que ve o filtro.
  const alternativas = findAndCountAll.mock.calls[0][0].where[Op.or] as Record<string, unknown>[];

  return (alternativas ?? []).map((alternativa) => Object.keys(alternativa)[0]);
}

describe('GET /professores — busca autenticada', () => {
  it('varre nome, e-mail, identificacao funcional e departamento', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarProfessores({ ...paginacao, busca: 'carlos' } as never);

    expect(camposBuscados(findAndCountAll)).toEqual([
      '$usuario.nome$',
      '$usuario.email$',
      'identificacaoFuncional',
      'departamento',
    ]);
  });

  it('usa correspondencia parcial e sem distincao de caixa', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarProfessores({ ...paginacao, busca: 'carlos' } as never);

    const [primeira] = findAndCountAll.mock.calls[0][0].where[Op.or];
    expect(primeira['$usuario.nome$'][Op.iLike]).toBe('%carlos%');
  });

  /** Sem termo, nenhum filtro: a listagem completa continua sendo o padrao. */
  it('sem busca, nao acrescenta condicao alguma', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarProfessores({ ...paginacao } as never);

    const { where } = findAndCountAll.mock.calls[0][0];
    expect(where[Op.or]).toBeUndefined();
    expect(Object.keys(where)).toHaveLength(0);
  });

  /**
   * `$usuario.nome$` so resolve se o JOIN estiver na consulta principal. Sem
   * isto o Sequelize move a paginacao para uma subconsulta sem o JOIN e a
   * consulta falha em tempo de execucao — erro que nenhum teste de tipo pega.
   */
  it('mantem o JOIN na consulta principal (subQuery: false)', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarProfessores({ ...paginacao, busca: 'ana' } as never);

    expect(findAndCountAll.mock.calls[0][0].subQuery).toBe(false);
  });

  it('repassa limite e offset da paginacao', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarProfessores({ pagina: 3, limite: 5, offset: 10 } as never);

    expect(findAndCountAll.mock.calls[0][0]).toMatchObject({ limit: 5, offset: 10 });
  });
});

describe('GET /professores/publicos — busca publica', () => {
  it('varre apenas nome e departamento', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarProfessoresPublicos({ ...paginacao, busca: 'computacao' } as never);

    expect(camposBuscados(findAndCountAll)).toEqual(['$usuario.nome$', 'departamento']);
  });

  /**
   * A afirmacao central deste arquivo, escrita pelo nome do campo para falhar
   * se alguem acrescentar o e-mail a lista por simetria com a rota autenticada.
   */
  it('NAO busca por e-mail nem por identificacao funcional', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarProfessoresPublicos({ ...paginacao, busca: 'fulano@ufx.edu.br' } as never);

    const campos = camposBuscados(findAndCountAll);

    expect(campos).not.toContain('$usuario.email$');
    expect(campos).not.toContain('identificacaoFuncional');
  });

  /**
   * Buscar nao pode alargar o que a rota devolve. O e-mail nao e omitido na
   * serializacao — ele nao e SELECIONADO —, e isso tem de continuar valendo
   * com o filtro aplicado.
   */
  it('continua selecionando so os campos publicos, mesmo com busca', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarProfessoresPublicos({ ...paginacao, busca: 'ana' } as never);

    const opcoes = findAndCountAll.mock.calls[0][0];

    expect(opcoes.attributes).toEqual(['usuarioId', 'departamento']);
    expect(opcoes.include[0].attributes).toEqual(['id', 'nome']);
    expect(opcoes.include[0].attributes).not.toContain('email');
  });

  /** Conta desativada nao deve aparecer no formulario publico de inscricao. */
  it('mantem o recorte de usuarios ativos junto com a busca', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarProfessoresPublicos({ ...paginacao, busca: 'ana' } as never);

    expect(findAndCountAll.mock.calls[0][0].include[0].where).toEqual({ ativo: true });
  });

  it('sem busca, nao acrescenta condicao alguma', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarProfessoresPublicos({ ...paginacao } as never);

    expect(Object.keys(findAndCountAll.mock.calls[0][0].where)).toHaveLength(0);
  });

  it('mantem o JOIN na consulta principal (subQuery: false)', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarProfessoresPublicos({ ...paginacao, busca: 'ana' } as never);

    expect(findAndCountAll.mock.calls[0][0].subQuery).toBe(false);
  });
});

describe('As duas rotas nao se confundem', () => {
  /**
   * Comparacao direta: a lista publica tem de ser um SUBCONJUNTO ESTRITO da
   * autenticada. Se as duas se igualarem — em qualquer direcao —, uma das duas
   * decisoes foi desfeita sem querer.
   */
  it('a busca publica e um subconjunto estrito da autenticada', async () => {
    const autenticada = montar();
    const publica = montar();

    await autenticada.service.listarProfessores({ ...paginacao, busca: 'x' } as never);
    await publica.service.listarProfessoresPublicos({ ...paginacao, busca: 'x' } as never);

    const campos = camposBuscados(autenticada.findAndCountAll);
    const camposPublicos = camposBuscados(publica.findAndCountAll);

    expect(camposPublicos.length).toBeLessThan(campos.length);
    expect(campos).toEqual(expect.arrayContaining(camposPublicos));
  });
});
