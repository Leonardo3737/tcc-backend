import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { PapelMonitoria } from '../../src/common/enums/papel-monitoria.enum';
import { StatusMonitoria } from '../../src/common/enums/status-monitoria.enum';
import { StatusParticipacao } from '../../src/common/enums/status-participacao.enum';
import { PerfilUsuario } from '../../src/common/enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../../src/common/types/usuario-autenticado';
import { ParticipantesService } from '../../src/modules/monitorias/participantes.service';

const MONITORIA_ID = 'm-1';

const professor: UsuarioAutenticado = {
  id: 'prof-1',
  nome: 'Joao',
  email: 'joao@ufx.edu.br',
  perfis: [PerfilUsuario.PROFESSOR],
};

const monitoriaAtiva = { id: MONITORIA_ID, status: StatusMonitoria.ATIVA } as never;

function vinculo(sobrescreve: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'v-1',
    monitoriaId: MONITORIA_ID,
    alunoId: 'aluno-1',
    papel: PapelMonitoria.MONITORADO,
    status: StatusParticipacao.ATIVO,
    ingressouEm: new Date(),
    encerradoEm: null,
    update: jest.fn(),
    ...sobrescreve,
  };
}

function montar(sobrescreve: Record<string, unknown> = {}) {
  const criado = vinculo({ papel: PapelMonitoria.MONITOR });

  const participanteModel = {
    create: jest.fn().mockResolvedValue(criado),
    findByPk: jest.fn().mockResolvedValue(criado),
    ...((sobrescreve.participanteModel as object) ?? {}),
  };

  const alunoModel = {
    findByPk: jest.fn().mockResolvedValue({ usuarioId: 'aluno-1', matricula: '2021' }),
    ...((sobrescreve.alunoModel as object) ?? {}),
  };

  const atendimentoModel = {
    count: jest.fn().mockResolvedValue(0),
    ...((sobrescreve.atendimentoModel as object) ?? {}),
  };

  const inscricaoModel = {
    count: jest.fn().mockResolvedValue(0),
    ...((sobrescreve.inscricaoModel as object) ?? {}),
  };

  const participacaoService = {
    buscarParticipanteAtivo: jest.fn().mockResolvedValue(null),
    buscarParticipantePorIdOuFalhar: jest.fn().mockResolvedValue(vinculo()),
    ...((sobrescreve.participacaoService as object) ?? {}),
  };

  const eventos = { emit: jest.fn() };

  const service = new ParticipantesService(
    participanteModel as never,
    alunoModel as never,
    atendimentoModel as never,
    inscricaoModel as never,
    participacaoService as never,
    eventos as never,
  );

  return {
    service,
    participanteModel,
    alunoModel,
    atendimentoModel,
    inscricaoModel,
    participacaoService,
    eventos,
  };
}

describe('Habilitacao de monitor (RN01) e vinculo do aluno (RN04)', () => {
  it('cria o vinculo com papel MONITOR e registra quem habilitou', async () => {
    const { service, participanteModel } = montar();

    await service.habilitarMonitor(monitoriaAtiva, 'aluno-1', professor);

    expect(participanteModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        monitoriaId: MONITORIA_ID,
        alunoId: 'aluno-1',
        papel: PapelMonitoria.MONITOR,
        status: StatusParticipacao.ATIVO,
        // Rastro da RN01: fica registrado qual professor autorizou.
        habilitadoPorUsuarioId: professor.id,
      }),
    );
  });

  it('auto-inscricao do aluno nao registra habilitador', async () => {
    const { service, participanteModel } = montar();

    await service.inscreverMonitorado(monitoriaAtiva, 'aluno-1', 'aluno-1');

    expect(participanteModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        papel: PapelMonitoria.MONITORADO,
        habilitadoPorUsuarioId: null,
      }),
    );
  });

  it('recusa vincular usuario que nao tem perfil ALUNO', async () => {
    const { service } = montar({ alunoModel: { findByPk: jest.fn().mockResolvedValue(null) } });

    await expect(service.habilitarMonitor(monitoriaAtiva, 'prof-1', professor)).rejects.toThrow(
      NotFoundException,
    );
  });

  it.each([StatusMonitoria.ENCERRADA, StatusMonitoria.CANCELADA])(
    'recusa novos participantes em monitoria %s',
    async (status) => {
      const { service } = montar();

      await expect(
        service.habilitarMonitor({ id: MONITORIA_ID, status } as never, 'aluno-1', professor),
      ).rejects.toThrow(ConflictException);
    },
  );

  /**
   * RN09. A garantia definitiva e o indice unico parcial no banco; este teste
   * cobre a camada que produz a mensagem util e evita a ida ao banco no caso
   * comum.
   */
  it('recusa acumulo de papeis na mesma monitoria (RN09)', async () => {
    const { service } = montar({
      participacaoService: {
        buscarParticipanteAtivo: jest
          .fn()
          .mockResolvedValue(vinculo({ papel: PapelMonitoria.MONITORADO })),
      },
    });

    await expect(service.habilitarMonitor(monitoriaAtiva, 'aluno-1', professor)).rejects.toThrow(
      /RN09/,
    );
  });
});

describe('Encerramento de vinculo (RN10)', () => {
  const aluno: UsuarioAutenticado = {
    id: 'aluno-1',
    nome: 'Ana',
    email: 'ana@ufx.edu.br',
    perfis: [PerfilUsuario.ALUNO],
  };

  it('encerra sem apagar: marca status e data', async () => {
    const alvo = vinculo();
    const { service } = montar({
      participacaoService: {
        buscarParticipanteAtivo: jest.fn().mockResolvedValue(null),
        buscarParticipantePorIdOuFalhar: jest.fn().mockResolvedValue(alvo),
      },
    });

    await service.encerrarVinculo(MONITORIA_ID, 'v-1', aluno, false);

    expect(alvo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: StatusParticipacao.ENCERRADO,
        encerradoEm: expect.any(Date),
      }),
    );
  });

  it('impede um aluno de encerrar a participacao de outro', async () => {
    const { service } = montar({
      participacaoService: {
        buscarParticipanteAtivo: jest.fn().mockResolvedValue(null),
        buscarParticipantePorIdOuFalhar: jest.fn().mockResolvedValue(vinculo({ alunoId: 'outro' })),
      },
    });

    await expect(service.encerrarVinculo(MONITORIA_ID, 'v-1', aluno, false)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('recusa encerrar monitor com atendimento AGENDADO pendente', async () => {
    const { service } = montar({
      atendimentoModel: { count: jest.fn().mockResolvedValue(2) },
      participacaoService: {
        buscarParticipanteAtivo: jest.fn().mockResolvedValue(null),
        buscarParticipantePorIdOuFalhar: jest
          .fn()
          .mockResolvedValue(vinculo({ papel: PapelMonitoria.MONITOR })),
      },
    });

    await expect(service.encerrarVinculo(MONITORIA_ID, 'v-1', aluno, true)).rejects.toThrow(
      ConflictException,
    );
  });

  it('recusa encerrar vinculo ja encerrado', async () => {
    const { service } = montar({
      participacaoService: {
        buscarParticipanteAtivo: jest.fn().mockResolvedValue(null),
        buscarParticipantePorIdOuFalhar: jest
          .fn()
          .mockResolvedValue(vinculo({ status: StatusParticipacao.ENCERRADO })),
      },
    });

    await expect(service.encerrarVinculo(MONITORIA_ID, 'v-1', aluno, true)).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('Validacao do monitor alvo ao agendar', () => {
  it('recusa participante que nao e MONITOR', async () => {
    const { service } = montar({
      participacaoService: {
        buscarParticipanteAtivo: jest.fn().mockResolvedValue(null),
        buscarParticipantePorIdOuFalhar: jest
          .fn()
          .mockResolvedValue(vinculo({ papel: PapelMonitoria.MONITORADO })),
      },
    });

    await expect(service.exigirMonitorAtivo(MONITORIA_ID, 'v-1')).rejects.toThrow(/nao e MONITOR/);
  });

  it('recusa monitor com vinculo encerrado', async () => {
    const { service } = montar({
      participacaoService: {
        buscarParticipanteAtivo: jest.fn().mockResolvedValue(null),
        buscarParticipantePorIdOuFalhar: jest
          .fn()
          .mockResolvedValue(
            vinculo({ papel: PapelMonitoria.MONITOR, status: StatusParticipacao.ENCERRADO }),
          ),
      },
    });

    await expect(service.exigirMonitorAtivo(MONITORIA_ID, 'v-1')).rejects.toThrow(
      ConflictException,
    );
  });
});
