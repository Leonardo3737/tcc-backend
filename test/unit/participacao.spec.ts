import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { PapelMonitoria } from '../../src/common/enums/papel-monitoria.enum';
import { StatusMonitoria } from '../../src/common/enums/status-monitoria.enum';
import { StatusParticipacao } from '../../src/common/enums/status-participacao.enum';
import { PerfilUsuario } from '../../src/common/enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../../src/common/types/usuario-autenticado';
import { ParticipantesService } from '../../src/modules/monitorias/participantes.service';

/** Curso compartilhado por aluno e monitoria no caminho feliz. */
const CURSO = '11111111-1111-4111-8111-00000000000c';

const MONITORIA_ID = 'm-1';

const professor: UsuarioAutenticado = {
  id: 'prof-1',
  nome: 'Joao',
  email: 'joao@ufx.edu.br',
  perfis: [PerfilUsuario.PROFESSOR],
};

const monitoriaAtiva = {
  id: MONITORIA_ID,
  status: StatusMonitoria.ATIVA,
  disciplinaId: 'disc-1',
} as never;

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
    findByPk: jest.fn().mockResolvedValue({
      usuarioId: 'aluno-1',
      matricula: '2021',
      cursoId: (sobrescreve.cursoDoAluno as string) ?? CURSO,
    }),
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

  /**
   * `count > 0` significa "a disciplina e oferecida no curso do aluno".
   * `cursoDoAluno` diferente do padrao simula aluno de curso que nao a oferece.
   */
  const disciplinaCursoModel = {
    count: jest
      .fn()
      .mockResolvedValue(((sobrescreve.cursoDoAluno as string) ?? CURSO) === CURSO ? 1 : 0),
  };

  const service = new ParticipantesService(
    participanteModel as never,
    alunoModel as never,
    disciplinaCursoModel as never,
    atendimentoModel as never,
    inscricaoModel as never,
    participacaoService as never,
    eventos as never,
    // Sequelize: a promocao a monitor abre transacao; o dublê executa direto.
    { transaction: jest.fn((cb: (t: unknown) => unknown) => cb({})) } as never,
  );

  return {
    service,
    participanteModel,
    alunoModel,
    atendimentoModel,
    inscricaoModel,
    participacaoService,
    disciplinaCursoModel,
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

/**
 * Um aluno so participa de monitoria de disciplina do proprio curso.
 *
 * A garantia real sao as FKs compostas em `monitoria_participantes`, que nao
 * admitem um `curso_id` que seja ao mesmo tempo da monitoria e de um aluno de
 * outro curso. Estes testes cobrem a checagem do service, que existe para dar
 * mensagem decente em vez de um erro de constraint traduzido genericamente.
 */
describe('Regra de curso: aluno so participa de monitoria do proprio curso', () => {
  const OUTRO_CURSO = '22222222-2222-4222-8222-00000000000c';

  it('aceita aluno do mesmo curso da monitoria', async () => {
    const { service, participanteModel } = montar();

    await service.inscreverMonitorado(monitoriaAtiva, 'aluno-1', 'aluno-1');

    expect(participanteModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ cursoId: CURSO }),
    );
  });

  it('recusa aluno de outro curso', async () => {
    const { service, participanteModel } = montar({ cursoDoAluno: OUTRO_CURSO });

    await expect(service.inscreverMonitorado(monitoriaAtiva, 'aluno-1', 'aluno-1')).rejects.toThrow(
      /curso/i,
    );

    expect(participanteModel.create).not.toHaveBeenCalled();
  });

  /** Monitorar pressupoe ter cursado a disciplina no mesmo curso. */
  it('a regra vale tambem para MONITOR', async () => {
    const { service } = montar({ cursoDoAluno: OUTRO_CURSO });

    await expect(service.habilitarMonitor(monitoriaAtiva, 'aluno-1', professor)).rejects.toThrow(
      ConflictException,
    );
  });

  /**
   * O curso do vinculo e copiado da MONITORIA, nao do aluno: a FK composta
   * exige que ele exista em `monitorias (id, curso_id)`, e usar o do aluno
   * tornaria a coincidencia acidental em vez de garantida.
   */
  it('grava o curso da monitoria no vinculo', async () => {
    const { service, participanteModel } = montar();

    await service.habilitarMonitor(monitoriaAtiva, 'aluno-1', professor);

    expect(participanteModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ cursoId: CURSO, papel: PapelMonitoria.MONITOR }),
    );
  });
});
