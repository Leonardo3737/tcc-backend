import { MARCA, paraRegistro, redigir } from '../../src/modules/logs/redacao';
import { LogsService } from '../../src/modules/logs/logs.service';

/**
 * Trilha de requisicoes.
 *
 * O risco deste modulo nao e deixar de registrar algo: e registrar demais.
 * Gravar o corpo cru colocaria em texto claro, numa tabela que qualquer SELECT
 * alcanca, exatamente o que o resto do projeto protege — a senha que o argon2
 * existe para nunca armazenar, o codigo de recuperacao que so vive como hash, e
 * o token que da acesso a conta.
 *
 * Por isso a maior parte destes testes e sobre o que NAO pode aparecer.
 */

describe('redigir — o que nunca pode ser gravado', () => {
  it.each([
    ['senha', { email: 'a@b.c', senha: 'segredo123' }],
    ['senhaAtual', { senhaAtual: 'segredo123', novaSenha: 'outro' }],
    ['senhaProvisoria', { nome: 'Bruno', senhaProvisoria: 'segredo123' }],
    ['codigo de recuperacao', { email: 'a@b.c', codigo: 'segredo123' }],
    ['token', { tokenDeAcesso: 'segredo123' }],
    ['authorization', { authorization: 'Bearer segredo123' }],
  ])('%s e substituido pela marca', (_caso, corpo) => {
    const saida = JSON.stringify(redigir(corpo));

    expect(saida).not.toContain('segredo123');
    expect(saida).toContain(MARCA);
  });

  /** As tres rotas de senha da API usam nomes diferentes para a mesma coisa. */
  it('cobre todos os nomes de senha que a API aceita', () => {
    const corpo = {
      senha: 'a1',
      senhaAtual: 'a2',
      novaSenha: 'a3',
      senhaProvisoria: 'a4',
      senhaHash: 'a5',
    };

    const saida = JSON.stringify(redigir(corpo));

    for (const valor of Object.values(corpo)) {
      expect(saida).not.toContain(valor);
    }
  });

  it('ignora a caixa do nome do campo', () => {
    const saida = JSON.stringify(redigir({ SENHA: 'segredo', Token: 'segredo' }));
    expect(saida).not.toContain('segredo');
  });

  /** Um corpo aninhado nao pode escapar da redacao. */
  it('alcanca qualquer profundidade e dentro de arrays', () => {
    const corpo = {
      usuarios: [{ dados: { credenciais: { senha: 'segredo123' } } }],
    };

    expect(JSON.stringify(redigir(corpo))).not.toContain('segredo123');
  });

  it('preserva o que nao e sensivel', () => {
    const corpo = { nome: 'Bruno', email: 'bruno@ufx.edu.br', matricula: '2021' };

    expect(redigir(corpo)).toEqual(corpo);
  });

  /**
   * Estrutura circular derrubaria o processo numa operacao que e mero registro.
   */
  it('nao estoura com estrutura circular', () => {
    const corpo: Record<string, unknown> = { nome: 'Bruno' };
    corpo.ele = corpo;

    expect(() => redigir(corpo)).not.toThrow();
  });

  it('trunca texto muito longo', () => {
    const saida = redigir({ descricao: 'x'.repeat(5_000) }) as { descricao: string };

    expect(saida.descricao.length).toBeLessThan(5_000);
    expect(saida.descricao).toContain('truncado');
  });
});

describe('paraRegistro', () => {
  it('devolve null para vazio, em vez de encher a tabela', () => {
    expect(paraRegistro(undefined)).toBeNull();
    expect(paraRegistro(null)).toBeNull();
    expect(paraRegistro({})).toBeNull();
    expect(paraRegistro([])).toBeNull();
  });

  it('limita o tamanho do que vai para a coluna', () => {
    const grande = { itens: Array.from({ length: 2_000 }, (_, i) => `item-${i}`) };
    const texto = paraRegistro(grande, 1_000)!;

    expect(texto.length).toBeLessThanOrEqual(1_020);
    expect(texto).toContain('truncado');
  });

  it('nao lanca com valor nao serializavel', () => {
    const corpo: Record<string, unknown> = {};
    corpo.ele = corpo;

    expect(() => paraRegistro(corpo)).not.toThrow();
  });
});

function requisicaoFalsa(sobrescreve: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    url: '/api/auth/login',
    originalUrl: '/api/auth/login',
    baseUrl: '/api/auth',
    route: { path: '/login' },
    body: { email: 'ana@ufx.edu.br', senha: 'segredo123' },
    query: {},
    ip: '127.0.0.1',
    get: () => 'jest',
    ...sobrescreve,
  } as never;
}

function montar(habilitados = true) {
  const criadas: Record<string, unknown>[] = [];

  const logModel = {
    create: jest.fn((dados: Record<string, unknown>) => {
      criadas.push(dados);
      return Promise.resolve(dados);
    }),
  };

  const config = { get: jest.fn().mockReturnValue(habilitados) };

  return { service: new LogsService(logModel as never, config as never), logModel, criadas };
}

describe('LogsService', () => {
  it('grava o corpo com a senha ja redigida', async () => {
    const { service, criadas } = montar();

    await service.registrar({ requisicao: requisicaoFalsa(), statusHttp: 200, duracaoMs: 12 });

    expect(String(criadas[0].corpo)).not.toContain('segredo123');
    expect(String(criadas[0].corpo)).toContain('ana@ufx.edu.br');
  });

  /** O token do login esta na RESPOSTA, nao no corpo — e precisa sumir igual. */
  it('redige tambem a resposta', async () => {
    const { service, criadas } = montar();

    await service.registrar({
      requisicao: requisicaoFalsa(),
      statusHttp: 200,
      duracaoMs: 12,
      resposta: { tokenDeAcesso: 'jwt.secreto.aqui', usuario: { nome: 'Ana' } },
    });

    expect(String(criadas[0].resposta)).not.toContain('jwt.secreto.aqui');
    expect(String(criadas[0].resposta)).toContain('Ana');
  });

  it('identifica o usuario pelo token, nunca pelo corpo', async () => {
    const { service, criadas } = montar();

    await service.registrar({
      requisicao: requisicaoFalsa({
        user: { id: 'u-1' },
        body: { usuarioId: 'u-FALSIFICADO' },
      }),
      statusHttp: 200,
      duracaoMs: 5,
    });

    expect(criadas[0].usuarioId).toBe('u-1');
  });

  it('registra requisicao anonima com usuario nulo', async () => {
    const { service, criadas } = montar();

    await service.registrar({ requisicao: requisicaoFalsa(), statusHttp: 401, duracaoMs: 5 });

    expect(criadas[0].usuarioId).toBeNull();
    expect(criadas[0].statusHttp).toBe(401);
  });

  /** Permite agregar por rota sem varrer milhares de caminhos com id. */
  it('guarda o caminho concreto e o padrao da rota', async () => {
    const { service, criadas } = montar();

    await service.registrar({
      requisicao: requisicaoFalsa({
        originalUrl: '/api/alunos/abc-123',
        baseUrl: '/api/alunos',
        route: { path: '/:usuarioId' },
      }),
      statusHttp: 200,
      duracaoMs: 5,
    });

    expect(criadas[0].caminho).toBe('/api/alunos/abc-123');
    expect(criadas[0].rota).toBe('/api/alunos/:usuarioId');
  });

  it('em 404 a rota fica nula — ninguem reconheceu o caminho', async () => {
    const { service, criadas } = montar();

    await service.registrar({
      requisicao: requisicaoFalsa({ originalUrl: '/api/nao-existe', route: undefined }),
      statusHttp: 404,
      duracaoMs: 2,
    });

    expect(criadas[0].rota).toBeNull();
  });

  it('guarda a mensagem do erro quando houve', async () => {
    const { service, criadas } = montar();

    await service.registrar({
      requisicao: requisicaoFalsa(),
      statusHttp: 409,
      duracaoMs: 8,
      erro: new Error('Ja existe um usuario com este e-mail.'),
    });

    expect(String(criadas[0].erro)).toContain('Ja existe um usuario');
  });

  it('nao registra o Swagger, que geraria ruido a cada pagina', async () => {
    const { service, logModel } = montar();

    await service.registrar({
      requisicao: requisicaoFalsa({ originalUrl: '/docs/swagger-ui.css' }),
      statusHttp: 200,
      duracaoMs: 1,
    });

    expect(logModel.create).not.toHaveBeenCalled();
  });

  it('nao grava nada quando desabilitado', async () => {
    const { service, logModel } = montar(false);

    await service.registrar({ requisicao: requisicaoFalsa(), statusHttp: 200, duracaoMs: 1 });

    expect(logModel.create).not.toHaveBeenCalled();
  });

  /**
   * A regra absoluta do modulo: banco de log indisponivel nao pode transformar
   * uma API saudavel em erro 500.
   */
  it('falha ao gravar nao escapa', async () => {
    const { service, logModel } = montar();
    logModel.create.mockRejectedValue(new Error('banco fora'));
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    await expect(
      service.registrar({ requisicao: requisicaoFalsa(), statusHttp: 200, duracaoMs: 1 }),
    ).resolves.toBeUndefined();
  });

  it('agendar retorna na hora, sem esperar o INSERT', () => {
    const { service, logModel } = montar();
    let resolver: (valor: Record<string, unknown>) => void = () => undefined;
    logModel.create.mockReturnValue(
      new Promise<Record<string, unknown>>((r) => {
        resolver = r;
      }),
    );

    // Se `agendar` aguardasse, esta chamada so retornaria apos `resolver()`.
    expect(
      service.agendar({ requisicao: requisicaoFalsa(), statusHttp: 200, duracaoMs: 1 }),
    ).toBeUndefined();

    resolver({});
  });
});
