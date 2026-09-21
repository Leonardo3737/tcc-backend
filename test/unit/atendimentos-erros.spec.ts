import { ArgumentsHost, BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common';
import { UniqueConstraintError, ForeignKeyConstraintError, DatabaseError } from 'sequelize';

import { TodasExcecoesFilter } from '../../src/common/filters/todas-excecoes.filter';
import { PapelMonitoria } from '../../src/common/enums/papel-monitoria.enum';
import { PerfilUsuario } from '../../src/common/enums/perfil-usuario.enum';
import { StatusMonitoria } from '../../src/common/enums/status-monitoria.enum';
import { UsuarioAutenticado } from '../../src/common/types/usuario-autenticado';
import { AtendimentosService } from '../../src/modules/atendimentos/atendimentos.service';

const MONITORIA_ID = 'm-1';

const aluno: UsuarioAutenticado = {
  id: 'aluno-1',
  nome: 'Bruno',
  email: 'bruno@ufx.edu.br',
  perfis: [PerfilUsuario.ALUNO],
};

const professor: UsuarioAutenticado = {
  id: 'prof-1',
  nome: 'Joao',
  email: 'joao@ufx.edu.br',
  perfis: [PerfilUsuario.PROFESSOR],
};

function daquiAHoras(horas: number): string {
  return new Date(Date.now() + horas * 3600_000).toISOString();
}

function contexto(sobrescreve: Record<string, unknown> = {}) {
  return {
    monitoria: { id: MONITORIA_ID, status: StatusMonitoria.ATIVA },
    ehProfessorResponsavel: false,
    participacao: { id: 'v-monitorado' },
    papel: PapelMonitoria.MONITORADO,
    ...sobrescreve,
  } as never;
}

function montar(sobrescreve: Record<string, unknown> = {}) {
  const disponibilidadesService = {
    validarJanela: jest.fn().mockResolvedValue(undefined),
    ...((sobrescreve.disponibilidadesService as object) ?? {}),
  };

  const monitoriasService = {
    exigirMonitoriaAtiva: jest.fn(),
    ...((sobrescreve.monitoriasService as object) ?? {}),
  };

  const participantesService = {
    exigirMonitorAtivo: jest.fn().mockResolvedValue({ id: 'v-monitor' }),
    ...((sobrescreve.participantesService as object) ?? {}),
  };

  const service = new AtendimentosService(
    {} as never,
    {} as never,
    {} as never,
    {} as never, // avaliacaoModel
    {} as never,
    {} as never,
    participantesService as never,
    monitoriasService as never,
    disponibilidadesService as never,
    { emit: jest.fn() } as never,
    // ConfigService: retornar undefined faz os defaults de D-15 valerem.
    { get: () => undefined } as never,
  );

  return { service, disponibilidadesService, monitoriasService, participantesService };
}

const dtoBase = {
  inicio: daquiAHoras(24),
  fim: daquiAHoras(25),
  assunto: 'Duvidas de limites',
  modalidade: 'REMOTO' as never,
};

describe('Agendamento — validacoes anteriores ao banco', () => {
  it('exige monitoria ATIVA', async () => {
    const { service } = montar({
      monitoriasService: {
        exigirMonitoriaAtiva: jest.fn(() => {
          throw new Error('monitoria nao esta ativa');
        }),
      },
    });

    await expect(
      service.agendar(contexto(), { ...dtoBase, monitorParticipanteId: 'v-monitor' }, aluno),
    ).rejects.toThrow(/nao esta ativa/);
  });

  it('recusa agendamento no passado', async () => {
    const { service } = montar();

    await expect(
      service.agendar(
        contexto(),
        {
          ...dtoBase,
          inicio: daquiAHoras(-3),
          fim: daquiAHoras(-2),
          monitorParticipanteId: 'v-monitor',
        },
        aluno,
      ),
    ).rejects.toThrow(/passado/);
  });

  it('recusa fim anterior ao inicio', async () => {
    const { service } = montar();

    await expect(
      service.agendar(
        contexto(),
        { ...dtoBase, inicio: daquiAHoras(25), fim: daquiAHoras(24) },
        aluno,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('recusa duracao abaixo do minimo', async () => {
    const { service } = montar();

    await expect(
      service.agendar(
        contexto(),
        {
          ...dtoBase,
          inicio: daquiAHoras(24),
          fim: new Date(Date.now() + 24 * 3600_000 + 5 * 60_000).toISOString(),
          monitorParticipanteId: 'v-monitor',
        },
        aluno,
      ),
    ).rejects.toThrow(/duracao minima/);
  });

  it('recusa duracao acima do maximo', async () => {
    const { service } = montar();

    await expect(
      service.agendar(
        contexto(),
        { ...dtoBase, inicio: daquiAHoras(24), fim: daquiAHoras(30), monitorParticipanteId: 'v-m' },
        aluno,
      ),
    ).rejects.toThrow(/duracao maxima/);
  });

  it('exige monitorParticipanteId quando quem agenda e o MONITORADO', async () => {
    const { service } = montar();

    await expect(service.agendar(contexto(), dtoBase, aluno)).rejects.toThrow(
      /monitorParticipanteId e obrigatorio/,
    );
  });

  /**
   * O professor administra a monitoria mas nao tem vinculo que ocupe agenda —
   * nao atende nem e atendido. Sem esta regra, seria preciso inventar um
   * participante para ele.
   */
  it('recusa o professor responsavel como agendador', async () => {
    const { service } = montar();

    await expect(
      service.agendar(
        contexto({ ehProfessorResponsavel: true, participacao: null, papel: null }),
        dtoBase,
        professor,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  /**
   * Quando o MONITOR agenda, o monitor da sessao e ele proprio — o campo do
   * corpo e ignorado. Sem isso, um monitor ocuparia a agenda de um colega.
   */
  it('ignora monitorParticipanteId quando quem agenda e o proprio MONITOR', async () => {
    const { service, participantesService, disponibilidadesService } = montar();

    await service
      .agendar(
        contexto({ papel: PapelMonitoria.MONITOR, participacao: { id: 'v-monitor-real' } }),
        { ...dtoBase, monitorParticipanteId: 'v-de-outro-monitor' },
        aluno,
      )
      .catch(() => undefined); // falha adiante, no model mockado — irrelevante aqui

    expect(participantesService.exigirMonitorAtivo).not.toHaveBeenCalled();
    expect(disponibilidadesService.validarJanela).toHaveBeenCalledWith(
      'v-monitor-real',
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('valida a janela de disponibilidade do monitor antes de gravar', async () => {
    const { service } = montar({
      disponibilidadesService: {
        validarJanela: jest.fn().mockRejectedValue(new Error('fora da disponibilidade')),
      },
    });

    await expect(
      service.agendar(contexto(), { ...dtoBase, monitorParticipanteId: 'v-monitor' }, aluno),
    ).rejects.toThrow(/fora da disponibilidade/);
  });
});

describe('Filtro global de excecoes — traducao de constraints', () => {
  function executar(excecao: unknown) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });

    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/teste', method: 'POST' }),
      }),
    } as unknown as ArgumentsHost;

    new TodasExcecoesFilter().catch(excecao, host);

    return { status, corpo: json.mock.calls[0]?.[0] };
  }

  function comConstraint<T extends Error>(erro: T, constraint: string): T {
    (erro as unknown as { parent: unknown }).parent = { constraint };
    return erro;
  }

  it('traduz violacao de RN09 em 409 com mensagem de dominio', () => {
    const { status, corpo } = executar(
      comConstraint(new UniqueConstraintError({ errors: [] }), 'ux_participante_ativo'),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(corpo.mensagem).toMatch(/RN09/);
  });

  it('traduz conflito de agenda do monitor (RN03)', () => {
    const { status, corpo } = executar(
      comConstraint(
        new DatabaseError({ message: 'exclusion violation' } as never),
        'ex_monitor_sem_conflito',
      ),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(corpo.mensagem).toMatch(/se sobrepoe/);
  });

  it('traduz FK composta de papel em mensagem de RN01/RN02', () => {
    const { corpo } = executar(
      comConstraint(
        new ForeignKeyConstraintError({ message: 'fk violation' } as never),
        'fk_atendimento_monitor',
      ),
    );

    expect(corpo.mensagem).toMatch(/MONITOR habilitado/);
  });

  it('devolve o formato padrao em todos os campos', () => {
    const { corpo } = executar(new BadRequestException('Dados invalidos.'));

    expect(corpo).toEqual(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        erro: expect.any(String),
        mensagem: expect.any(String),
        caminho: '/api/teste',
        timestamp: expect.any(String),
      }),
    );
  });

  it('transforma erros de validacao em lista de detalhes', () => {
    const { corpo } = executar(
      new BadRequestException({ message: ['nota deve estar entre 1 e 5'], error: 'Bad Request' }),
    );

    expect(corpo.mensagem).toBe('Dados invalidos na requisicao.');
    expect(corpo.detalhes).toEqual(['nota deve estar entre 1 e 5']);
  });

  /** Erro inesperado nunca deve vazar stack, SQL ou nome de tabela ao cliente. */
  it('nao expoe detalhe interno em erro inesperado', () => {
    const { status, corpo } = executar(new Error('senha_hash invalida na tabela usuarios'));

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(corpo.mensagem).toBe('Erro interno no servidor.');
    expect(JSON.stringify(corpo)).not.toMatch(/senha_hash/);
  });
});
