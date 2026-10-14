import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { AuthController } from '../../src/modules/auth/auth.controller';
import { CHAVE_ROTA_PUBLICA } from '../../src/common/decorators/publico.decorator';
import { PerfilGuard } from '../../src/common/guards/perfil.guard';
import { PerfilUsuario } from '../../src/common/enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../../src/common/types/usuario-autenticado';
import { UsuariosService } from '../../src/modules/usuarios/usuarios.service';

const professor: UsuarioAutenticado = {
  id: 'prof-1',
  nome: 'Joao',
  email: 'joao@ufx.edu.br',
  perfis: [PerfilUsuario.PROFESSOR],
};

interface OpcoesDeMontagem {
  dominiosPermitidos?: string[];
  /** Falso simula Brevo fora do ar: o envio nao acontece. */
  emailEntregue?: boolean;
  emailConfigurado?: boolean;
  ambiente?: string;
}

function montar(opcoes: OpcoesDeMontagem | string[] = {}) {
  // Aceita a forma antiga (lista de dominios) para nao reescrever os testes de D-09.
  const {
    dominiosPermitidos = [],
    emailEntregue = true,
    emailConfigurado = true,
    ambiente = 'development',
  } = Array.isArray(opcoes) ? { dominiosPermitidos: opcoes } : opcoes;

  const criados: Record<string, unknown>[] = [];

  const usuarioModel = {
    create: jest.fn((dados: Record<string, unknown>) => {
      criados.push(dados);
      return Promise.resolve({ id: 'novo-1', ...dados, createdAt: new Date() });
    }),
  };

  const alunoModel = { create: jest.fn().mockResolvedValue({ matricula: '2021', curso: null }) };
  const professorModel = {
    create: jest.fn().mockResolvedValue({ identificacaoFuncional: null, departamento: null }),
  };

  // A transacao e transparente para estes testes: executa o callback direto.
  const sequelize = { transaction: jest.fn((cb: (t: unknown) => unknown) => cb({})) };
  /**
   * O hash falso nao pode ecoar o texto puro, senao o teste de "nao persiste a
   * senha em claro" passaria ou falharia por artefato do dublê.
   */
  const textoPorHash = new Map<string, string>();
  const hashService = {
    gerar: jest.fn((valor: string) => {
      const falso = `$argon2id$fake${textoPorHash.size}`;
      textoPorHash.set(falso, valor);
      return Promise.resolve(falso);
    }),
  };

  const config = {
    get: jest.fn((chave: string) => (chave === 'app.ambiente' ? ambiente : dominiosPermitidos)),
  };

  const emailService = {
    enviar: jest.fn().mockResolvedValue(emailEntregue),
    estaConfigurado: jest.fn().mockReturnValue(emailConfigurado),
  };

  const service = new UsuariosService(
    usuarioModel as never,
    alunoModel as never,
    professorModel as never,
    sequelize as never,
    hashService as never,
    {} as never,
    config as never,
    emailService as never,
  );

  return {
    service,
    usuarioModel,
    alunoModel,
    professorModel,
    sequelize,
    hashService,
    emailService,
    criados,
    textoPorHash,
  };
}

describe('Criacao de usuarios por professor — autorizacao', () => {
  function guardExigindoProfessor() {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([PerfilUsuario.PROFESSOR]),
    } as unknown as Reflector;

    return new PerfilGuard(reflector);
  }

  function contexto(usuario: UsuarioAutenticado) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user: usuario }) }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as never;
  }

  it('permite que um PROFESSOR alcance a rota de criacao', () => {
    expect(guardExigindoProfessor().canActivate(contexto(professor))).toBe(true);
  });

  /**
   * A regressao que mais importa aqui: se um ALUNO alcancasse estas rotas, ele
   * criaria a propria conta de professor e passaria a habilitar monitores (RN01).
   */
  it('bloqueia ALUNO nas rotas de criacao de usuario', () => {
    const aluno: UsuarioAutenticado = {
      id: 'aluno-1',
      nome: 'Ana',
      email: 'ana@ufx.edu.br',
      perfis: [PerfilUsuario.ALUNO],
    };

    expect(() => guardExigindoProfessor().canActivate(contexto(aluno))).toThrow(ForbiddenException);
  });
});

describe('Criacao de ALUNO pelo professor', () => {
  const dto = {
    nome: 'Bruno Aluno',
    email: 'bruno@ufx.edu.br',
    matricula: '2021001234',
    curso: 'Engenharia',
  };

  it('grava a autoria vinda do token', async () => {
    const { service, criados } = montar();

    await service.criarAlunoComoProfessor(dto, professor.id);

    expect(criados[0]).toMatchObject({
      nome: 'Bruno Aluno',
      email: 'bruno@ufx.edu.br',
      criadoPorUsuarioId: 'prof-1',
    });
  });

  it('nunca persiste a senha em texto claro', async () => {
    const { service, criados, hashService, textoPorHash } = montar();

    await service.criarAlunoComoProfessor(dto, professor.id);

    const senhaGerada = hashService.gerar.mock.calls[0][0] as string;

    expect(textoPorHash.get(criados[0].senhaHash as string)).toBe(senhaGerada);
    expect(JSON.stringify(criados[0])).not.toContain(senhaGerada);
  });

  it('cria o vinculo de aluno com a matricula informada', async () => {
    const { service, alunoModel } = montar();

    await service.criarAlunoComoProfessor(dto, professor.id);

    expect(alunoModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ matricula: '2021001234', curso: 'Engenharia' }),
      expect.anything(),
    );
  });
});

describe('Criacao de PROFESSOR por outro professor', () => {
  const dto = {
    nome: 'Maria Souza',
    email: 'maria@ufx.edu.br',
    departamento: 'Computacao',
  };

  it('grava a autoria — a unica contencao disponivel sem ADMIN', async () => {
    const { service, criados } = montar();

    await service.criarProfessorComoProfessor(dto, professor.id);

    expect(criados[0].criadoPorUsuarioId).toBe('prof-1');
  });

  /**
   * Nao ha segredo compartilhado envolvido: a autorizacao e ser professor
   * autenticado, verificada pelo PerfilGuard antes de chegar aqui. O antigo
   * CODIGO_CADASTRO_PROFESSOR existia para o auto-cadastro publico e saiu com ele.
   */
  it('nao exige nenhum codigo alem da autenticacao', async () => {
    const { service, professorModel } = montar();

    await expect(service.criarProfessorComoProfessor(dto, professor.id)).resolves.toBeDefined();

    expect(professorModel.create).toHaveBeenCalled();
  });
});

/**
 * A regressao que este bloco protege e a mais grave do projeto.
 *
 * Enquanto existiu POST /api/auth/registro/professor, qualquer pessoa com acesso
 * a rede podia se tornar PROFESSOR e, dai, criar monitorias e habilitar monitores
 * (RN01). Fechar o auto-cadastro so vale se ele continuar fechado: reintroduzir
 * uma rota publica neste controller faz este teste falhar.
 *
 * E deliberadamente estrutural — le os metadados dos decorators, nao o
 * comportamento. Uma rota de registro que volte sem @Publico ainda seria um
 * caminho de criacao fora de /alunos e /professores, e tambem e reprovada.
 */
describe('Auth nao cria identidade', () => {
  // Indexacao por string em um prototype: o cast e a forma de percorrer os
  // handlers sem listar os nomes a mao, que e justamente o que se quer descobrir.
  const prototipo = AuthController.prototype as unknown as Record<string, object>;

  const metodos = Object.getOwnPropertyNames(AuthController.prototype).filter(
    (nome) => nome !== 'constructor',
  );

  it('expoe uma unica rota: login', () => {
    expect(metodos).toEqual(['login']);
  });

  it('nao expoe nenhuma rota de registro', () => {
    const caminhos = metodos.map(
      (nome) => Reflect.getMetadata(PATH_METADATA, prototipo[nome]) as string,
    );

    expect(caminhos).toEqual(['login']);
    expect(caminhos.some((caminho) => caminho.includes('registro'))).toBe(false);
  });

  /**
   * O login e publico por necessidade. Se um dia houver outra rota publica aqui,
   * ela precisa ser uma decisao consciente — nao um decorator herdado por copia.
   */
  it('mantem o login como a unica rota publica de auth', () => {
    const publicas = metodos.filter((nome) =>
      Reflect.getMetadata(CHAVE_ROTA_PUBLICA, prototipo[nome]),
    );

    expect(publicas).toEqual(['login']);
  });
});

describe('D-09 — dominio institucional vale nos dois caminhos de criacao', () => {
  it('aceita e-mail de dominio permitido', async () => {
    const { service } = montar(['ufx.edu.br']);

    await expect(
      service.criarAlunoComoProfessor(
        { nome: 'Bruno', email: 'bruno@ufx.edu.br', matricula: '2021' },
        professor.id,
      ),
    ).resolves.toBeDefined();
  });

  /**
   * A validacao mora no UsuariosService justamente para nao existir em duas
   * copias: com o auto-cadastro fechado, estes sao os dois unicos caminhos de
   * criacao da API, e deixar um deles sem a regra seria uma porta dos fundos
   * silenciosa.
   */
  it('recusa dominio de fora tambem quando quem cria e o professor', async () => {
    const { service } = montar(['ufx.edu.br']);

    await expect(
      service.criarProfessorComoProfessor(
        { nome: 'Externa', email: 'alguem@gmail.com' },
        professor.id,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('nao restringe nada quando a lista esta vazia', async () => {
    const { service } = montar([]);

    await expect(
      service.criarProfessorComoProfessor(
        { nome: 'Externa', email: 'alguem@gmail.com' },
        professor.id,
      ),
    ).resolves.toBeDefined();
  });
});

/**
 * A senha deixou de ser escolhida por quem cria a conta.
 *
 * O que estes testes protegem: a credencial e gerada pelo servidor, vai para o
 * e-mail da PESSOA, nunca aparece na resposta HTTP, e — se nao puder ser
 * entregue — a conta nao nasce. Uma conta cuja senha nao chegou a ninguem e
 * inacessivel e nem o professor consegue consertar.
 */
describe('Senha gerada pelo servidor', () => {
  const dto = { nome: 'Bruno Aluno', email: 'bruno@ufx.edu.br', matricula: '2021001234' };

  it('gera a senha sem receber nada de quem cria a conta', async () => {
    const { service, hashService } = montar();

    await service.criarAlunoComoProfessor(dto, professor.id);

    const senha = hashService.gerar.mock.calls[0][0] as string;

    expect(typeof senha).toBe('string');
    expect(senha.length).toBeGreaterThanOrEqual(12);
    // base64url: nada de +, / ou =, que quebram ao copiar de um e-mail.
    expect(senha).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('cada conta recebe uma senha diferente', async () => {
    const senhas = new Set<string>();

    for (let i = 0; i < 5; i += 1) {
      const { service, hashService } = montar();
      await service.criarAlunoComoProfessor(dto, professor.id);
      senhas.add(hashService.gerar.mock.calls[0][0] as string);
    }

    expect(senhas.size).toBe(5);
  });

  it('envia a senha para o e-mail da pessoa, nao para quem criou', async () => {
    const { service, emailService, hashService } = montar();

    await service.criarAlunoComoProfessor(dto, professor.id);

    const [mensagem] = emailService.enviar.mock.calls[0];
    const senha = hashService.gerar.mock.calls[0][0] as string;

    expect(mensagem.para).toEqual([{ email: 'bruno@ufx.edu.br', nome: 'Bruno Aluno' }]);
    expect(mensagem.texto).toContain(senha);
  });

  /**
   * A resposta volta para o professor. Se a senha estivesse nela, a credencial
   * passaria por log de proxy, histórico do navegador e devtools de quem criou
   * — exatamente o que gerar no servidor veio evitar.
   */
  it('a senha NAO aparece na resposta da API', async () => {
    const { service, hashService } = montar();

    const resposta = await service.criarAlunoComoProfessor(dto, professor.id);
    const senha = hashService.gerar.mock.calls[0][0] as string;

    expect(JSON.stringify(resposta)).not.toContain(senha);
  });

  it('professor criado tambem recebe senha por e-mail', async () => {
    const { service, emailService } = montar();

    await service.criarProfessorComoProfessor(
      { nome: 'Maria Souza', email: 'maria@ufx.edu.br' },
      professor.id,
    );

    expect(emailService.enviar).toHaveBeenCalledTimes(1);
    expect(emailService.enviar.mock.calls[0][0].para).toEqual([
      { email: 'maria@ufx.edu.br', nome: 'Maria Souza' },
    ]);
  });
});

describe('Entrega da senha falha: a conta nao nasce', () => {
  const dto = { nome: 'Bruno Aluno', email: 'bruno@ufx.edu.br', matricula: '2021001234' };

  it('devolve 503 quando o provedor recusa a mensagem', async () => {
    const { service } = montar({ emailEntregue: false });

    await expect(service.criarAlunoComoProfessor(dto, professor.id)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  /**
   * O que de fato desfaz a criacao e a entrega rodar DENTRO da transacao. Como
   * o dublê de transacao apenas repassa a excecao, o que da para verificar aqui
   * e que ela sobe de dentro do callback — em producao, e isso que dispara o
   * rollback.
   */
  it('a excecao sobe de dentro da transacao', async () => {
    const { service, sequelize } = montar({ emailEntregue: false });

    await expect(service.criarAlunoComoProfessor(dto, professor.id)).rejects.toThrow();

    expect(sequelize.transaction).toHaveBeenCalled();
  });

  it('a mensagem diz que a conta NAO foi criada', async () => {
    const { service } = montar({ emailEntregue: false });

    await expect(service.criarAlunoComoProfessor(dto, professor.id)).rejects.toThrow(
      /conta NAO foi criada/i,
    );
  });

  /**
   * Em desenvolvimento, sem Brevo, criar usuario precisa continuar funcionando
   * — senao toda conta criada localmente seria inacessivel.
   */
  it('sem e-mail configurado em desenvolvimento, a criacao segue', async () => {
    const { service, emailService } = montar({ emailConfigurado: false });

    await expect(service.criarAlunoComoProfessor(dto, professor.id)).resolves.toBeDefined();
    expect(emailService.enviar).not.toHaveBeenCalled();
  });

  it('sem e-mail configurado em desenvolvimento, a senha vai para o log', async () => {
    const { service, hashService } = montar({ emailConfigurado: false });
    const registrado: string[] = [];

    jest.spyOn(service['logger'], 'warn').mockImplementation((t: unknown) => {
      registrado.push(String(t));
    });

    await service.criarAlunoComoProfessor(dto, professor.id);

    expect(registrado.join('\n')).toContain(hashService.gerar.mock.calls[0][0] as string);
  });

  /** A guarda que importa: em producao a senha nunca vai para o log. */
  it('em producao a senha nunca vai para o log', async () => {
    const { service, hashService } = montar({ emailConfigurado: false, ambiente: 'production' });
    const registrado: string[] = [];

    jest.spyOn(service['logger'], 'warn').mockImplementation((t: unknown) => {
      registrado.push(String(t));
    });

    await service.criarAlunoComoProfessor(dto, professor.id);

    expect(registrado.join('\n')).not.toContain(hashService.gerar.mock.calls[0][0] as string);
  });
});
