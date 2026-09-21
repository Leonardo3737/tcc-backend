import { ConflictException, ForbiddenException } from '@nestjs/common';

import { PerfilUsuario } from '../../src/common/enums/perfil-usuario.enum';
import { StatusAtendimento } from '../../src/common/enums/status-atendimento.enum';
import { StatusInscricao } from '../../src/common/enums/status-inscricao.enum';
import { UsuarioAutenticado } from '../../src/common/types/usuario-autenticado';
import { AvaliacoesService } from '../../src/modules/avaliacoes/avaliacoes.service';
import { EVENTO_AVALIACAO_REGISTRADA } from '../../src/modules/gamificacao/eventos';

const ATENDIMENTO_ID = 'a-1';

const monitorado: UsuarioAutenticado = {
  id: 'aluno-1',
  nome: 'Bruno',
  email: 'bruno@ufx.edu.br',
  perfis: [PerfilUsuario.ALUNO],
};

function inscricao(sobrescreve: Record<string, unknown> = {}) {
  return {
    id: 'i-1',
    atendimentoId: ATENDIMENTO_ID,
    status: StatusInscricao.PRESENTE,
    atendimento: {
      id: ATENDIMENTO_ID,
      status: StatusAtendimento.REALIZADO,
      monitoriaId: 'm-1',
      monitorParticipanteId: 'v-monitor',
    },
    ...sobrescreve,
  };
}

function montar(sobrescreve: Record<string, unknown> = {}) {
  const avaliacaoModel = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({
      id: 'av-1',
      atendimentoParticipanteId: 'i-1',
      nota: 5,
      comentario: null,
      createdAt: new Date(),
    }),
    findAll: jest.fn().mockResolvedValue([]),
    ...((sobrescreve.avaliacaoModel as object) ?? {}),
  };

  const inscricaoModel = {
    findOne: jest.fn().mockResolvedValue(inscricao()),
    ...((sobrescreve.inscricaoModel as object) ?? {}),
  };

  const participacaoService = { exigirAcesso: jest.fn().mockResolvedValue({}) };
  const eventos = { emit: jest.fn() };

  const service = new AvaliacoesService(
    avaliacaoModel as never,
    inscricaoModel as never,
    participacaoService as never,
    eventos as never,
  );

  return { service, avaliacaoModel, inscricaoModel, eventos };
}

describe('Avaliacao de atendimento (RN05 e RN06)', () => {
  it('registra a avaliacao do monitorado que participou e esteve presente', async () => {
    const { service, avaliacaoModel } = montar();

    const resposta = await service.avaliar(ATENDIMENTO_ID, { nota: 5 }, monitorado);

    expect(avaliacaoModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ atendimentoParticipanteId: 'i-1', nota: 5 }),
    );
    expect(resposta.nota).toBe(5);
  });

  /**
   * RN05. A consulta filtra a inscricao PELO ALUNO AUTENTICADO — quem nao
   * participou simplesmente nao tem inscricao para apontar, e a avaliacao nao
   * tem como existir.
   */
  it('recusa quem nao participou do atendimento (RN05)', async () => {
    const { service } = montar({ inscricaoModel: { findOne: jest.fn().mockResolvedValue(null) } });

    await expect(service.avaliar(ATENDIMENTO_ID, { nota: 5 }, monitorado)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('recusa avaliar atendimento ainda AGENDADO (RN06)', async () => {
    const { service } = montar({
      inscricaoModel: {
        findOne: jest.fn().mockResolvedValue(
          inscricao({
            atendimento: { status: StatusAtendimento.AGENDADO, monitoriaId: 'm-1' },
            status: StatusInscricao.INSCRITO,
          }),
        ),
      },
    });

    await expect(service.avaliar(ATENDIMENTO_ID, { nota: 5 }, monitorado)).rejects.toThrow(
      /depois que o atendimento for concluido/,
    );
  });

  it('recusa avaliar atendimento CANCELADO, com mensagem propria', async () => {
    const { service } = montar({
      inscricaoModel: {
        findOne: jest.fn().mockResolvedValue(
          inscricao({
            atendimento: { status: StatusAtendimento.CANCELADO, monitoriaId: 'm-1' },
            status: StatusInscricao.CANCELADA,
          }),
        ),
      },
    });

    await expect(service.avaliar(ATENDIMENTO_ID, { nota: 5 }, monitorado)).rejects.toThrow(
      /cancelado/,
    );
  });

  it('recusa avaliacao de quem faltou', async () => {
    const { service } = montar({
      inscricaoModel: {
        findOne: jest.fn().mockResolvedValue(inscricao({ status: StatusInscricao.AUSENTE })),
      },
    });

    await expect(service.avaliar(ATENDIMENTO_ID, { nota: 5 }, monitorado)).rejects.toThrow(
      /presenca registrada/,
    );
  });

  it('recusa avaliar duas vezes o mesmo atendimento', async () => {
    const { service } = montar({
      avaliacaoModel: { findOne: jest.fn().mockResolvedValue({ id: 'av-existente' }) },
    });

    await expect(service.avaliar(ATENDIMENTO_ID, { nota: 4 }, monitorado)).rejects.toThrow(
      ConflictException,
    );
  });

  /**
   * O acoplamento com a gamificacao e um evento, nao uma chamada. Se este teste
   * passar a exigir um GamificacaoService injetado, o desacoplamento se perdeu.
   */
  it('emite evento de avaliacao registrada em vez de chamar a gamificacao', async () => {
    const { service, eventos } = montar();

    await service.avaliar(ATENDIMENTO_ID, { nota: 4 }, monitorado);

    expect(eventos.emit).toHaveBeenCalledWith(
      EVENTO_AVALIACAO_REGISTRADA,
      expect.objectContaining({ monitorParticipanteId: 'v-monitor', nota: 4 }),
    );
  });

  it('nao emite evento quando a avaliacao e recusada', async () => {
    const { service, eventos } = montar({
      avaliacaoModel: { findOne: jest.fn().mockResolvedValue({ id: 'ja-existe' }) },
    });

    await expect(service.avaliar(ATENDIMENTO_ID, { nota: 4 }, monitorado)).rejects.toThrow();
    expect(eventos.emit).not.toHaveBeenCalled();
  });
});
