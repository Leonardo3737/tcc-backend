import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PerfilUsuario } from '../../src/common/enums/perfil-usuario.enum';
import { PapelMonitoria } from '../../src/common/enums/papel-monitoria.enum';
import { StatusParticipacao } from '../../src/common/enums/status-participacao.enum';
import { PerfilGuard } from '../../src/common/guards/perfil.guard';
import { ParticipacaoGuard } from '../../src/modules/monitorias/guards/participacao.guard';
import { ParticipacaoService } from '../../src/modules/monitorias/participacao.service';
import { UsuarioAutenticado } from '../../src/common/types/usuario-autenticado';

function criarContexto(requisicao: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => requisicao }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

function criarReflector(metadado: unknown): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(metadado) } as unknown as Reflector;
}

const aluno: UsuarioAutenticado = {
  id: 'aluno-1',
  nome: 'Ana',
  email: 'ana@ufx.edu.br',
  perfis: [PerfilUsuario.ALUNO],
};

const professor: UsuarioAutenticado = {
  id: 'prof-1',
  nome: 'Joao',
  email: 'joao@ufx.edu.br',
  perfis: [PerfilUsuario.PROFESSOR],
};

describe('PerfilGuard — autorizacao por perfil de identidade', () => {
  it('libera quando a rota nao exige perfil', () => {
    const guard = new PerfilGuard(criarReflector(undefined));
    expect(guard.canActivate(criarContexto({ user: aluno }))).toBe(true);
  });

  it('bloqueia ALUNO em rota restrita a PROFESSOR', () => {
    const guard = new PerfilGuard(criarReflector([PerfilUsuario.PROFESSOR]));

    expect(() => guard.canActivate(criarContexto({ user: aluno }))).toThrow(ForbiddenException);
  });

  it('libera usuario que acumula os dois perfis (D-12)', () => {
    const guard = new PerfilGuard(criarReflector([PerfilUsuario.PROFESSOR]));
    const posGraduando: UsuarioAutenticado = {
      ...aluno,
      perfis: [PerfilUsuario.ALUNO, PerfilUsuario.PROFESSOR],
    };

    expect(guard.canActivate(criarContexto({ user: posGraduando }))).toBe(true);
  });

  it('bloqueia requisicao sem usuario quando ha perfil exigido', () => {
    const guard = new PerfilGuard(criarReflector([PerfilUsuario.ALUNO]));

    expect(() => guard.canActivate(criarContexto({}))).toThrow(ForbiddenException);
  });
});

describe('ParticipacaoGuard — autorizacao contextual por monitoria', () => {
  const monitoriaId = '11111111-1111-4111-8111-111111111111';

  /**
   * O dublê e um ParticipacaoService REAL com apenas `obterContexto` stubado.
   *
   * A decisao (papel exigido, professor PERMITIDO/EXIGIDO/NEGADO) mora em
   * `exigirRequisito`, e nao mais no guard, porque as ferramentas MCP precisam
   * dela sem ter rota HTTP. Stubar o metodo inteiro faria estes testes provarem
   * que o dublê funciona; stubar so a ida ao banco mantem a regra sob teste e,
   * de quebra, cobre tambem o caminho do MCP.
   */
  function criarGuard(metadado: unknown, contextoParticipacao: unknown) {
    const servico = Object.create(ParticipacaoService.prototype) as ParticipacaoService;
    const obterContexto = jest.fn().mockResolvedValue(contextoParticipacao);
    servico.obterContexto = obterContexto;

    return {
      guard: new ParticipacaoGuard(criarReflector(metadado), servico),
      servico: { obterContexto },
    };
  }

  const semVinculo = {
    monitoria: { id: monitoriaId },
    ehProfessorResponsavel: false,
    participacao: null,
    papel: null,
  };

  const comoMonitor = {
    monitoria: { id: monitoriaId },
    ehProfessorResponsavel: false,
    participacao: { id: 'v-1', status: StatusParticipacao.ATIVO },
    papel: PapelMonitoria.MONITOR,
  };

  const comoMonitorado = { ...comoMonitor, papel: PapelMonitoria.MONITORADO };

  const comoResponsavel = {
    monitoria: { id: monitoriaId },
    ehProfessorResponsavel: true,
    participacao: null,
    papel: null,
  };

  it('bloqueia quem nao participa da monitoria (RN04/RN07)', async () => {
    const { guard } = criarGuard({}, semVinculo);

    await expect(
      guard.canActivate(criarContexto({ user: aluno, params: { monitoriaId } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('libera qualquer participante ativo quando nao ha papel exigido', async () => {
    const { guard } = criarGuard({}, comoMonitorado);

    await expect(
      guard.canActivate(criarContexto({ user: aluno, params: { monitoriaId } })),
    ).resolves.toBe(true);
  });

  it('bloqueia MONITORADO em rota exclusiva de MONITOR', async () => {
    const { guard } = criarGuard({ papeis: [PapelMonitoria.MONITOR] }, comoMonitorado);

    await expect(
      guard.canActivate(criarContexto({ user: aluno, params: { monitoriaId } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('libera MONITOR em rota exclusiva de MONITOR', async () => {
    const { guard } = criarGuard({ papeis: [PapelMonitoria.MONITOR] }, comoMonitor);

    await expect(
      guard.canActivate(criarContexto({ user: aluno, params: { monitoriaId } })),
    ).resolves.toBe(true);
  });

  /**
   * Regressao de uma decisao facil de perder: o professor administra a monitoria,
   * mas nao tem agenda de monitor. Se ele passasse aqui, o service teria de
   * inventar de quem seria a disponibilidade.
   */
  it('bloqueia o professor responsavel quando a rota o marca como NEGADO', async () => {
    const { guard } = criarGuard(
      { papeis: [PapelMonitoria.MONITOR], professorResponsavel: 'NEGADO' },
      comoResponsavel,
    );

    await expect(
      guard.canActivate(criarContexto({ user: professor, params: { monitoriaId } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('libera o professor responsavel quando a rota o EXIGE', async () => {
    const { guard } = criarGuard({ professorResponsavel: 'EXIGIDO' }, comoResponsavel);

    await expect(
      guard.canActivate(criarContexto({ user: professor, params: { monitoriaId } })),
    ).resolves.toBe(true);
  });

  it('bloqueia um professor que NAO e o responsavel por esta monitoria', async () => {
    const { guard } = criarGuard({ professorResponsavel: 'EXIGIDO' }, semVinculo);

    await expect(
      guard.canActivate(criarContexto({ user: professor, params: { monitoriaId } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('anexa o contexto resolvido a requisicao, evitando consulta repetida', async () => {
    const { guard } = criarGuard({}, comoMonitor);
    const requisicao: Record<string, unknown> = { user: aluno, params: { monitoriaId } };

    await guard.canActivate(criarContexto(requisicao));

    expect(requisicao.contextoParticipacao).toBe(comoMonitor);
  });
});
