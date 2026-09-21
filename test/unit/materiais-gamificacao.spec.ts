import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';

import { PerfilUsuario } from '../../src/common/enums/perfil-usuario.enum';
import { StatusMonitoria } from '../../src/common/enums/status-monitoria.enum';
import { TipoPontuacao } from '../../src/common/enums/tipo-pontuacao.enum';
import { UsuarioAutenticado } from '../../src/common/types/usuario-autenticado';
import { GamificacaoService } from '../../src/modules/gamificacao/gamificacao.service';
import {
  AtendimentoRealizadoEvento,
  AvaliacaoRegistradaEvento,
} from '../../src/modules/gamificacao/eventos';
import { MateriaisService } from '../../src/modules/materiais/materiais.service';

const MONITORIA_ID = 'm-1';

const monitor: UsuarioAutenticado = {
  id: 'aluno-1',
  nome: 'Ana',
  email: 'ana@ufx.edu.br',
  perfis: [PerfilUsuario.ALUNO],
};

const outroMonitor: UsuarioAutenticado = { ...monitor, id: 'aluno-2', nome: 'Bruno' };

const professor: UsuarioAutenticado = {
  id: 'prof-1',
  nome: 'Joao',
  email: 'joao@ufx.edu.br',
  perfis: [PerfilUsuario.PROFESSOR],
};

function contexto(sobrescreve: Record<string, unknown> = {}) {
  return {
    monitoria: { id: MONITORIA_ID, status: StatusMonitoria.ATIVA },
    ehProfessorResponsavel: false,
    participacao: { id: 'v-1' },
    papel: 'MONITOR',
    ...sobrescreve,
  } as never;
}

function material(sobrescreve: Record<string, unknown> = {}) {
  return {
    id: 'mat-1',
    monitoriaId: MONITORIA_ID,
    autorUsuarioId: monitor.id,
    titulo: 'Lista 1',
    descricao: null,
    tipo: 'LINK',
    url: 'https://exemplo.com/lista.pdf',
    removidoEm: null,
    createdAt: new Date(),
    update: jest.fn(),
    ...sobrescreve,
  };
}

describe('Materiais — acesso e propriedade (RN07 e RN08)', () => {
  function montar(atual = material()) {
    const materialModel = {
      create: jest.fn().mockResolvedValue(atual),
      findByPk: jest.fn().mockResolvedValue(atual),
      findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    };

    return { service: new MateriaisService(materialModel as never), materialModel, atual };
  }

  it('publica como LINK, com autoria do usuario autenticado', async () => {
    const { service, materialModel } = montar();

    await service.publicar(
      contexto(),
      { titulo: 'Lista 1', url: 'https://exemplo.com/lista.pdf' },
      monitor,
    );

    expect(materialModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        monitoriaId: MONITORIA_ID,
        autorUsuarioId: monitor.id,
        tipo: 'LINK',
      }),
    );
  });

  it.each([StatusMonitoria.ENCERRADA, StatusMonitoria.CANCELADA])(
    'recusa publicar em monitoria %s',
    async (status) => {
      const { service } = montar();

      await expect(
        service.publicar(
          contexto({ monitoria: { id: MONITORIA_ID, status } }),
          { titulo: 'Lista', url: 'https://exemplo.com/x.pdf' },
          monitor,
        ),
      ).rejects.toThrow(ConflictException);
    },
  );

  /**
   * O guard so verifica o PAPEL. Dois monitores tem o mesmo papel, entao a
   * propriedade do recurso precisa ser verificada aqui — senao um monitor edita
   * o material do colega.
   */
  it('impede um monitor de editar material publicado por outro monitor', async () => {
    const { service } = montar(material({ autorUsuarioId: 'aluno-1' }));

    await expect(
      service.atualizar(contexto(), 'mat-1', { titulo: 'Sequestrado' }, outroMonitor),
    ).rejects.toThrow(ForbiddenException);
  });

  it('permite ao professor responsavel editar material de qualquer autor', async () => {
    const { service, atual } = montar();

    await service.atualizar(
      contexto({ ehProfessorResponsavel: true, participacao: null, papel: null }),
      'mat-1',
      { titulo: 'Corrigido' },
      professor,
    );

    expect(atual.update).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'Corrigido' }));
  });

  /**
   * Um ID valido de outra monitoria nao pode virar acesso: sem esta checagem,
   * quem participa da monitoria A leria material da monitoria B (RN07).
   */
  it('recusa material que pertence a outra monitoria', async () => {
    const { service } = montar(material({ monitoriaId: 'outra-monitoria' }));

    await expect(service.detalhar(MONITORIA_ID, 'mat-1')).rejects.toThrow(NotFoundException);
  });

  it('remove logicamente, preservando a linha (RN10)', async () => {
    const { service, atual } = montar();

    await service.remover(contexto(), 'mat-1', monitor);

    expect(atual.update).toHaveBeenCalledWith(
      expect.objectContaining({ removidoEm: expect.any(Date), removidoPorUsuarioId: monitor.id }),
    );
  });

  it('recusa remover material ja removido', async () => {
    const { service } = montar(material({ removidoEm: new Date() }));

    await expect(service.remover(contexto(), 'mat-1', monitor)).rejects.toThrow(ConflictException);
  });
});

describe('Gamificacao — pontuacao a partir de eventos', () => {
  function montar(sobrescreve: Record<string, unknown> = {}) {
    const pontuacaoModel = {
      create: jest.fn().mockResolvedValue({}),
      findAll: jest.fn().mockResolvedValue([]),
      ...((sobrescreve.pontuacaoModel as object) ?? {}),
    };

    const participanteModel = {
      findByPk: jest
        .fn()
        .mockImplementation((id: string) => Promise.resolve({ id, alunoId: `usuario-de-${id}` })),
      ...((sobrescreve.participanteModel as object) ?? {}),
    };

    return {
      service: new GamificacaoService(pontuacaoModel as never, participanteModel as never),
      pontuacaoModel,
      participanteModel,
    };
  }

  it('pontua o monitor e cada monitorado presente', async () => {
    const { service, pontuacaoModel } = montar();

    await service.aoRealizarAtendimento(
      new AtendimentoRealizadoEvento('a-1', MONITORIA_ID, 'v-monitor', ['v-al1', 'v-al2']),
    );

    expect(pontuacaoModel.create).toHaveBeenCalledTimes(3);
    expect(pontuacaoModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: 'usuario-de-v-monitor',
        tipo: TipoPontuacao.ATENDIMENTO_REALIZADO,
        pontos: 10,
        referenciaId: 'a-1',
      }),
    );
    expect(pontuacaoModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: 'usuario-de-v-al1',
        tipo: TipoPontuacao.PARTICIPACAO_ATENDIMENTO,
        pontos: 5,
      }),
    );
  });

  it('nao pontua ninguem alem do monitor quando todos faltaram', async () => {
    const { service, pontuacaoModel } = montar();

    await service.aoRealizarAtendimento(
      new AtendimentoRealizadoEvento('a-1', MONITORIA_ID, 'v-monitor', []),
    );

    expect(pontuacaoModel.create).toHaveBeenCalledTimes(1);
  });

  it('usa a nota da avaliacao como pontuacao do monitor', async () => {
    const { service, pontuacaoModel } = montar();

    await service.aoRegistrarAvaliacao(
      new AvaliacaoRegistradaEvento('av-1', MONITORIA_ID, 'v-monitor', 4),
    );

    expect(pontuacaoModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: TipoPontuacao.AVALIACAO_RECEBIDA, pontos: 4 }),
    );
  });

  /**
   * Idempotencia: o mesmo evento processado duas vezes nao dobra pontos. A
   * garantia e a UNIQUE (tipo, referencia, usuario); aqui verificamos que a
   * violacao e tratada como no-op em vez de estourar.
   */
  it('trata concessao duplicada como no-op', async () => {
    const duplicado = new UniqueConstraintError({ errors: [] });
    const { service } = montar({
      pontuacaoModel: { create: jest.fn().mockRejectedValue(duplicado) },
    });

    await expect(
      service.aoRegistrarAvaliacao(new AvaliacaoRegistradaEvento('av-1', MONITORIA_ID, 'v-m', 5)),
    ).resolves.toBeUndefined();
  });

  /**
   * Gamificacao e consequencia, nao pre-condicao: uma falha aqui nao pode
   * derrubar o atendimento que ja foi realizado.
   */
  it('engole falhas para nao derrubar o nucleo do dominio', async () => {
    const { service } = montar({
      pontuacaoModel: { create: jest.fn().mockRejectedValue(new Error('banco fora')) },
    });

    await expect(
      service.aoRealizarAtendimento(
        new AtendimentoRealizadoEvento('a-1', MONITORIA_ID, 'v-monitor', []),
      ),
    ).resolves.toBeUndefined();
  });
});
