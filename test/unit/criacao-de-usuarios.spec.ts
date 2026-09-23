import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

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

function montar(dominiosPermitidos: string[] = []) {
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
  const hashService = { gerar: jest.fn().mockResolvedValue('hash-argon2id') };
  const config = { get: jest.fn().mockReturnValue(dominiosPermitidos) };

  const service = new UsuariosService(
    usuarioModel as never,
    alunoModel as never,
    professorModel as never,
    sequelize as never,
    hashService as never,
    {} as never,
    config as never,
  );

  return { service, usuarioModel, alunoModel, professorModel, hashService, criados };
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
    senhaProvisoria: 'provisoria2026',
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
    const { service, criados, hashService } = montar();

    await service.criarAlunoComoProfessor(dto, professor.id);

    expect(hashService.gerar).toHaveBeenCalledWith('provisoria2026');
    expect(criados[0].senhaHash).toBe('hash-argon2id');
    expect(JSON.stringify(criados[0])).not.toContain('provisoria2026');
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
    senhaProvisoria: 'provisoria2026',
    departamento: 'Computacao',
  };

  it('grava a autoria — a unica contencao disponivel sem ADMIN', async () => {
    const { service, criados } = montar();

    await service.criarProfessorComoProfessor(dto, professor.id);

    expect(criados[0].criadoPorUsuarioId).toBe('prof-1');
  });

  /**
   * CODIGO_CADASTRO_PROFESSOR protege o auto-cadastro publico, onde e a unica
   * barreira. Aqui a barreira e estar autenticado como professor — exigir o
   * codigo tambem seria pedir um segredo de infraestrutura a quem nao o tem.
   */
  it('nao exige o codigo de cadastro publico', async () => {
    const { service, professorModel } = montar();

    await expect(service.criarProfessorComoProfessor(dto, professor.id)).resolves.toBeDefined();

    expect(professorModel.create).toHaveBeenCalled();
  });
});

describe('D-09 — dominio institucional vale nos dois caminhos de criacao', () => {
  it('aceita e-mail de dominio permitido', async () => {
    const { service } = montar(['ufx.edu.br']);

    await expect(
      service.criarAlunoComoProfessor(
        {
          nome: 'Bruno',
          email: 'bruno@ufx.edu.br',
          senhaProvisoria: 'provisoria2026',
          matricula: '2021',
        },
        professor.id,
      ),
    ).resolves.toBeDefined();
  });

  /**
   * A validacao mora no UsuariosService justamente para nao existir em duas
   * copias: fechar o auto-cadastro e deixar a criacao pelo professor aberta
   * seria uma porta dos fundos silenciosa.
   */
  it('recusa dominio de fora tambem quando quem cria e o professor', async () => {
    const { service } = montar(['ufx.edu.br']);

    await expect(
      service.criarProfessorComoProfessor(
        { nome: 'Externa', email: 'alguem@gmail.com', senhaProvisoria: 'provisoria2026' },
        professor.id,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('nao restringe nada quando a lista esta vazia', async () => {
    const { service } = montar([]);

    await expect(
      service.criarProfessorComoProfessor(
        { nome: 'Externa', email: 'alguem@gmail.com', senhaProvisoria: 'provisoria2026' },
        professor.id,
      ),
    ).resolves.toBeDefined();
  });
});
