import { BadRequestException } from '@nestjs/common';

import { RecuperacaoSenhaService } from '../../src/modules/auth/recuperacao-senha.service';

/**
 * Recuperacao de senha — o fluxo com a maior superficie de ataque da API.
 *
 * Sao duas rotas publicas que operam sobre conta alheia a partir de um codigo
 * de 6 digitos. O que estes testes protegem nao e o caminho feliz (que e
 * trivial), e sim as quatro defesas que o tornam seguro:
 *
 *   1. resposta identica para conta existente e inexistente (enumeracao);
 *   2. teto de tentativas por codigo (forca bruta);
 *   3. expiracao e uso unico;
 *   4. o codigo nunca persiste nem e registrado em texto claro.
 */

const MENSAGEM_UNICA = 'Codigo invalido ou expirado. Solicite um novo codigo.';

interface OpcoesDeMontagem {
  usuario?: Record<string, unknown> | null;
  recuperacao?: Record<string, unknown> | null;
  codigoConfere?: boolean;
  emailConfigurado?: boolean;
  ambiente?: string;
}

function montar(opcoes: OpcoesDeMontagem = {}) {
  const {
    usuario = { id: 'u-1', nome: 'Ana Martins', email: 'ana@ufx.edu.br', ativo: true },
    recuperacao = null,
    codigoConfere = true,
    emailConfigurado = true,
    ambiente = 'development',
  } = opcoes;

  const usuarioAtualizar = jest.fn().mockResolvedValue(undefined);
  const recuperacaoAtualizar = jest.fn().mockResolvedValue(undefined);

  const usuarioModel = {
    findOne: jest.fn().mockResolvedValue(usuario ? { ...usuario, update: usuarioAtualizar } : null),
  };

  const recuperacaoModel = {
    findOne: jest
      .fn()
      .mockResolvedValue(recuperacao ? { ...recuperacao, update: recuperacaoAtualizar } : null),
    update: jest.fn().mockResolvedValue([0]),
    create: jest.fn().mockResolvedValue({ id: 'r-1' }),
  };

  // A transacao e transparente nestes testes: executa o callback direto.
  const sequelize = { transaction: jest.fn((cb: (t: unknown) => unknown) => cb({})) };

  /**
   * O hash falso NAO pode conter o texto puro.
   *
   * Um dublê do tipo `hash(${valor})` faria os testes de "nao persiste em texto
   * claro" falharem por artefato do proprio dublê — e, pior, passariam a
   * falhar/passar pelo motivo errado. Aqui o hash e opaco e a correspondencia
   * fica num mapa que so o teste enxerga, como acontece com o argon2 de verdade.
   */
  const textoPorHash = new Map<string, string>();

  const hashService = {
    gerar: jest.fn((valor: string) => {
      const falso = `$argon2id$fake${textoPorHash.size}`;
      textoPorHash.set(falso, valor);
      return Promise.resolve(falso);
    }),
    conferir: jest.fn().mockResolvedValue(codigoConfere),
    gastarTempoDeVerificacao: jest.fn().mockResolvedValue(undefined),
  };

  const emailService = {
    enviar: jest.fn().mockResolvedValue(true),
    estaConfigurado: jest.fn().mockReturnValue(emailConfigurado),
  };

  const config = { get: jest.fn().mockReturnValue(ambiente) };

  const service = new RecuperacaoSenhaService(
    recuperacaoModel as never,
    usuarioModel as never,
    sequelize as never,
    hashService as never,
    emailService as never,
    config as never,
  );

  return {
    service,
    usuarioModel,
    recuperacaoModel,
    hashService,
    emailService,
    usuarioAtualizar,
    recuperacaoAtualizar,
    textoPorHash,
  };
}

/** Extrai o codigo do corpo do e-mail que o servico mandou enviar. */
function codigoEnviado(emailService: { enviar: jest.Mock }): string {
  const [mensagem] = emailService.enviar.mock.calls[0];
  const encontrado = /\b(\d{6})\b/.exec(mensagem.texto);

  if (!encontrado) {
    throw new Error(`Nenhum codigo de 6 digitos no corpo: ${mensagem.texto}`);
  }

  return encontrado[1];
}

function ativa(sobrescritas: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    usuarioId: 'u-1',
    codigoHash: 'hash(483920)',
    expiraEm: new Date(Date.now() + 10 * 60_000),
    tentativas: 0,
    usadoEm: null,
    invalidadoEm: null,
    ...sobrescritas,
  };
}

describe('solicitar — nao revela se a conta existe', () => {
  it('e-mail inexistente: nao cria codigo, nao envia e nao lanca', async () => {
    const { service, recuperacaoModel, emailService } = montar({ usuario: null });

    await expect(service.solicitar({ email: 'ninguem@ufx.edu.br' })).resolves.toBeUndefined();

    expect(recuperacaoModel.create).not.toHaveBeenCalled();
    expect(emailService.enviar).not.toHaveBeenCalled();
  });

  /**
   * O ponto fino: sem gastar o mesmo tempo de argon2, a conta inexistente
   * responderia visivelmente mais rapido e a rota viraria um enumerador. Mesma
   * defesa que o login aplica.
   */
  it('e-mail inexistente: paga o custo do hash mesmo assim', async () => {
    const { service, hashService } = montar({ usuario: null });

    await service.solicitar({ email: 'ninguem@ufx.edu.br' });

    expect(hashService.gerar).toHaveBeenCalledTimes(1);
  });

  it('conta desativada segue o mesmo caminho da inexistente', async () => {
    const { service, recuperacaoModel, emailService, hashService } = montar({
      usuario: { id: 'u-1', nome: 'Ana', email: 'ana@ufx.edu.br', ativo: false },
    });

    await expect(service.solicitar({ email: 'ana@ufx.edu.br' })).resolves.toBeUndefined();

    expect(recuperacaoModel.create).not.toHaveBeenCalled();
    expect(emailService.enviar).not.toHaveBeenCalled();
    expect(hashService.gerar).toHaveBeenCalledTimes(1);
  });
});

describe('solicitar — codigo gerado', () => {
  it('envia um codigo de 6 digitos para o e-mail da conta', async () => {
    const { service, emailService } = montar();

    await service.solicitar({ email: 'ana@ufx.edu.br' });

    const [mensagem] = emailService.enviar.mock.calls[0];

    expect(mensagem.para).toEqual([{ email: 'ana@ufx.edu.br', nome: 'Ana Martins' }]);
    expect(codigoEnviado(emailService)).toMatch(/^\d{6}$/);
  });

  /**
   * O que vai para o banco e o hash. Uma copia do banco nao pode render um
   * codigo utilizavel — e o mesmo motivo pelo qual a senha nao e armazenada.
   */
  it('persiste o HASH do codigo, nunca o codigo', async () => {
    const { service, recuperacaoModel, emailService, textoPorHash } = montar();

    await service.solicitar({ email: 'ana@ufx.edu.br' });

    const codigo = codigoEnviado(emailService);
    const [gravado] = recuperacaoModel.create.mock.calls[0];

    // O hash corresponde ao codigo enviado...
    expect(textoPorHash.get(gravado.codigoHash)).toBe(codigo);
    // ...e o codigo nao aparece em nenhum campo da linha.
    expect(JSON.stringify(gravado)).not.toContain(codigo);
  });

  it('define expiracao no futuro', async () => {
    const { service, recuperacaoModel } = montar();

    await service.solicitar({ email: 'ana@ufx.edu.br' });

    const [gravado] = recuperacaoModel.create.mock.calls[0];
    expect(gravado.expiraEm.getTime()).toBeGreaterThan(Date.now());
  });

  /**
   * Sem isto, cada pedido somaria mais um codigo valido e o atacante ganharia
   * tentativas de graca.
   */
  it('invalida o codigo anterior antes de criar outro', async () => {
    const { service, recuperacaoModel } = montar();

    await service.solicitar({ email: 'ana@ufx.edu.br' });

    expect(recuperacaoModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ invalidadoEm: expect.any(Date) }),
      expect.objectContaining({ where: expect.objectContaining({ usuarioId: 'u-1' }) }),
    );
  });

  it('com e-mail configurado, o codigo nao aparece no log', async () => {
    const { service, emailService } = montar({ emailConfigurado: true });
    const registrado: string[] = [];
    const capturar = (texto: unknown) => registrado.push(String(texto));

    jest.spyOn(service['logger'], 'warn').mockImplementation(capturar);
    jest.spyOn(service['logger'], 'log').mockImplementation(capturar);

    await service.solicitar({ email: 'ana@ufx.edu.br' });

    expect(registrado.join('\n')).not.toContain(codigoEnviado(emailService));
  });

  /**
   * A saida de emergencia de desenvolvimento nao pode existir em producao: sem
   * a chave do Brevo, codigos de troca de senha iriam parar no log.
   */
  it('em producao, nunca registra o codigo — mesmo sem e-mail configurado', async () => {
    const { service, emailService } = montar({ emailConfigurado: false, ambiente: 'production' });
    const registrado: string[] = [];

    jest.spyOn(service['logger'], 'warn').mockImplementation((t: unknown) => {
      registrado.push(String(t));
    });

    await service.solicitar({ email: 'ana@ufx.edu.br' });

    expect(registrado.join('\n')).not.toContain(codigoEnviado(emailService));
  });

  it('em desenvolvimento sem e-mail configurado, registra o codigo para teste local', async () => {
    const { service, emailService } = montar({ emailConfigurado: false, ambiente: 'development' });
    const registrado: string[] = [];

    jest.spyOn(service['logger'], 'warn').mockImplementation((t: unknown) => {
      registrado.push(String(t));
    });

    await service.solicitar({ email: 'ana@ufx.edu.br' });

    expect(registrado.join('\n')).toContain(codigoEnviado(emailService));
  });
});

describe('confirmar — toda falha devolve a MESMA resposta', () => {
  const entrada = { email: 'ana@ufx.edu.br', codigo: '483920', novaSenha: 'senhaNova456' };

  it.each([
    ['conta inexistente', { usuario: null }],
    ['conta desativada', { usuario: { id: 'u-1', email: 'a@b.c', nome: 'A', ativo: false } }],
    ['nenhum codigo ativo', { recuperacao: null }],
    ['codigo expirado', { recuperacao: ativa({ expiraEm: new Date(Date.now() - 1000) }) }],
    ['codigo errado', { recuperacao: ativa(), codigoConfere: false }],
  ])('%s: 400 com a mensagem generica', async (_caso, opcoes) => {
    const { service } = montar(opcoes as OpcoesDeMontagem);

    await expect(service.confirmar(entrada)).rejects.toThrow(BadRequestException);
    await expect(service.confirmar(entrada)).rejects.toThrow(MENSAGEM_UNICA);
  });

  /**
   * Distinguir os casos seria util ao usuario legitimo e util demais a quem
   * sonda: "codigo expirado" ja confirma que a conta existe e que alguem pediu
   * recuperacao para ela.
   */
  it('a mensagem e literalmente a mesma em todos os casos', async () => {
    const casos: OpcoesDeMontagem[] = [
      { usuario: null },
      { recuperacao: null },
      { recuperacao: ativa({ expiraEm: new Date(Date.now() - 1000) }) },
      { recuperacao: ativa(), codigoConfere: false },
    ];

    const mensagens = await Promise.all(
      casos.map(async (opcoes) => {
        try {
          await montar(opcoes).service.confirmar(entrada);
          return 'NAO LANCOU';
        } catch (erro) {
          return (erro as Error).message;
        }
      }),
    );

    expect(new Set(mensagens).size).toBe(1);
    expect(mensagens[0]).toBe(MENSAGEM_UNICA);
  });
});

describe('confirmar — forca bruta', () => {
  const entrada = { email: 'ana@ufx.edu.br', codigo: '000000', novaSenha: 'senhaNova456' };

  it('codigo errado incrementa o contador de tentativas', async () => {
    const { service, recuperacaoAtualizar } = montar({
      recuperacao: ativa({ tentativas: 1 }),
      codigoConfere: false,
    });

    await expect(service.confirmar(entrada)).rejects.toThrow(BadRequestException);

    expect(recuperacaoAtualizar).toHaveBeenCalledWith(expect.objectContaining({ tentativas: 2 }));
  });

  /**
   * E o teto de tentativas, nao os 6 digitos, que define a resistencia: com 5
   * chances por codigo, a probabilidade de acerto e 5 em 1.000.000.
   */
  it('a quinta tentativa errada queima o codigo', async () => {
    const { service, recuperacaoAtualizar } = montar({
      recuperacao: ativa({ tentativas: 4 }),
      codigoConfere: false,
    });

    await expect(service.confirmar(entrada)).rejects.toThrow(BadRequestException);

    expect(recuperacaoAtualizar).toHaveBeenCalledWith(
      expect.objectContaining({ tentativas: 5, invalidadoEm: expect.any(Date) }),
    );
  });

  it('a quarta ainda nao invalida', async () => {
    const { service, recuperacaoAtualizar } = montar({
      recuperacao: ativa({ tentativas: 3 }),
      codigoConfere: false,
    });

    await expect(service.confirmar(entrada)).rejects.toThrow(BadRequestException);

    expect(recuperacaoAtualizar).toHaveBeenCalledWith({ tentativas: 4 });
  });

  it('codigo expirado e invalidado em vez de ficar disponivel', async () => {
    const { service, recuperacaoAtualizar } = montar({
      recuperacao: ativa({ expiraEm: new Date(Date.now() - 1000) }),
    });

    await expect(service.confirmar(entrada)).rejects.toThrow(BadRequestException);

    expect(recuperacaoAtualizar).toHaveBeenCalledWith(
      expect.objectContaining({ invalidadoEm: expect.any(Date) }),
    );
  });
});

describe('confirmar — caminho feliz', () => {
  const entrada = { email: 'ana@ufx.edu.br', codigo: '483920', novaSenha: 'senhaNova456' };

  it('grava o hash da nova senha, nunca a senha', async () => {
    const { service, usuarioAtualizar, textoPorHash } = montar({ recuperacao: ativa() });

    await service.confirmar(entrada);

    const [dados] = usuarioAtualizar.mock.calls[0];

    expect(textoPorHash.get(dados.senhaHash)).toBe('senhaNova456');
    expect(JSON.stringify(dados)).not.toContain('senhaNova456');
  });

  /** Uso unico: o mesmo codigo nao serve duas vezes. */
  it('marca o codigo como usado', async () => {
    const { service, recuperacaoAtualizar } = montar({ recuperacao: ativa() });

    await service.confirmar(entrada);

    expect(recuperacaoAtualizar).toHaveBeenCalledWith(
      expect.objectContaining({ usadoEm: expect.any(Date) }),
      expect.anything(),
    );
  });

  /**
   * Trocar a senha e consumir o codigo precisam ser atomicos: se o segundo
   * falhasse, o codigo continuaria valido depois de ja ter sido usado.
   */
  it('troca a senha e consome o codigo na mesma transacao', async () => {
    const { service, usuarioAtualizar, recuperacaoAtualizar } = montar({ recuperacao: ativa() });

    await service.confirmar(entrada);

    expect(usuarioAtualizar).toHaveBeenCalledWith(expect.anything(), { transaction: {} });
    expect(recuperacaoAtualizar).toHaveBeenCalledWith(expect.anything(), { transaction: {} });
  });
});
