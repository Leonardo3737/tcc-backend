import { ConflictException } from '@nestjs/common';
import { Op } from 'sequelize';

import { ModalidadeAtendimento } from '../../src/common/enums/modalidade-atendimento.enum';
import { OrigemAtendimento } from '../../src/common/enums/origem-atendimento.enum';
import { PerfilUsuario } from '../../src/common/enums/perfil-usuario.enum';
import { StatusAtendimento } from '../../src/common/enums/status-atendimento.enum';
import { StatusInscricao } from '../../src/common/enums/status-inscricao.enum';
import { StatusParticipacao } from '../../src/common/enums/status-participacao.enum';
import { UsuarioAutenticado } from '../../src/common/types/usuario-autenticado';
import { AtendimentoRespostaDto } from '../../src/modules/atendimentos/dto/atendimento-resposta.dto';
import { AtendimentosService } from '../../src/modules/atendimentos/atendimentos.service';
import { UsuariosService } from '../../src/modules/usuarios/usuarios.service';

const aluno: UsuarioAutenticado = {
  id: 'aluno-1',
  nome: 'Bruno',
  email: 'bruno@ufx.edu.br',
  perfis: [PerfilUsuario.ALUNO],
};

describe('B1 — busca de alunos para o fluxo da RN01', () => {
  function montar(vinculados: { alunoId: string }[] = []) {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    const participanteModel = { findAll: jest.fn().mockResolvedValue(vinculados) };

    return {
      service: new UsuariosService(
        {} as never,
        { findAndCountAll } as never,
        {} as never,
        {} as never,
        {} as never,
        participanteModel as never,
        // ConfigService: sem dominios configurados, a validacao e no-op.
        { get: () => [] } as never,
      ),
      findAndCountAll,
      participanteModel,
    };
  }

  it('busca em matricula, nome e e-mail ao mesmo tempo', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarAlunos({ pagina: 1, limite: 20, offset: 0, busca: 'ana' } as never);

    // `Op.iLike` e Symbol: JSON.stringify nao enxerga o valor.
    const condicoes = findAndCountAll.mock.calls[0][0].where[Op.or];
    expect(condicoes).toHaveLength(3);
    expect(condicoes.map((c: object) => Object.keys(c)[0])).toEqual([
      'matricula',
      '$usuario.nome$',
      '$usuario.email$',
    ]);
    expect(condicoes[0].matricula[Op.iLike]).toBe('%ana%');
    expect(condicoes[2]['$usuario.email$'][Op.iLike]).toBe('%ana%');
  });

  /**
   * Evita o 409 previsivel de RN09: o professor nao deve nem ver quem ja
   * participa da monitoria na lista de candidatos a monitor.
   */
  it('exclui quem ja tem vinculo ativo na monitoria informada', async () => {
    const { service, findAndCountAll, participanteModel } = montar([
      { alunoId: 'ja-participa-1' },
      { alunoId: 'ja-participa-2' },
    ]);

    await service.listarAlunos({
      pagina: 1,
      limite: 20,
      offset: 0,
      semVinculoAtivoNaMonitoria: 'm-1',
    } as never);

    expect(participanteModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { monitoriaId: 'm-1', status: StatusParticipacao.ATIVO },
      }),
    );

    const { where } = findAndCountAll.mock.calls[0][0];
    expect(where.usuarioId[Op.notIn]).toEqual(['ja-participa-1', 'ja-participa-2']);
  });

  it('nao aplica exclusao quando a monitoria ainda nao tem participantes', async () => {
    const { service, findAndCountAll } = montar([]);

    await service.listarAlunos({
      pagina: 1,
      limite: 20,
      offset: 0,
      semVinculoAtivoNaMonitoria: 'm-1',
    } as never);

    expect(findAndCountAll.mock.calls[0][0].where.usuarioId).toBeUndefined();
  });
});

describe('B3/B6/B8 — campos derivados do atendimento', () => {
  function atendimento(sobrescreve: Record<string, unknown> = {}) {
    return {
      id: 'a-1',
      monitoriaId: 'm-1',
      monitorParticipanteId: 'v-monitor',
      inicio: new Date(Date.now() + 3600_000),
      fim: new Date(Date.now() + 7200_000),
      vagas: 3,
      modalidade: ModalidadeAtendimento.REMOTO,
      local: null,
      assunto: 'Limites',
      status: StatusAtendimento.AGENDADO,
      origem: OrigemAtendimento.OFERTA_MONITOR,
      motivoCancelamento: null,
      inscricoes: [],
      monitoria: {
        id: 'm-1',
        ano: 2026,
        semestre: 2,
        disciplina: { id: 'd-1', codigo: 'MAT101', nome: 'Calculo I' },
      },
      ...sobrescreve,
    } as never;
  }

  function inscricao(sobrescreve: Record<string, unknown> = {}) {
    return {
      id: 'i-1',
      participanteId: 'v-1',
      status: StatusInscricao.PRESENTE,
      inscritoEm: new Date(),
      participante: { alunoId: 'aluno-1', aluno: { usuario: { nome: 'Bruno' } } },
      ...sobrescreve,
    };
  }

  // B6: sem isto, montar "Calculo I — terca 14h" custava um request por linha.
  it('inclui o resumo legivel da monitoria', () => {
    const dto = AtendimentoRespostaDto.deModelo(atendimento());

    expect(dto.monitoria).toEqual({
      id: 'm-1',
      periodo: '2026/2',
      codigoDisciplina: 'MAT101',
      nomeDisciplina: 'Calculo I',
    });
  });

  // B8: derivado no relogio do SERVIDOR, nao no do navegador.
  it.each([
    ['aceita quando ha vaga e ainda nao comecou', {}, true],
    ['recusa quando lotado', { vagas: 1, inscricoes: [inscricao()] }, false],
    ['recusa quando cancelado', { status: StatusAtendimento.CANCELADO }, false],
    ['recusa quando ja comecou', { inicio: new Date(Date.now() - 3600_000) }, false],
  ])('aceitaInscricao: %s', (_titulo, sobrescreve, esperado) => {
    expect(AtendimentoRespostaDto.deModelo(atendimento(sobrescreve)).aceitaInscricao).toBe(
      esperado,
    );
  });

  // B3: o cliente decide entre "Avaliar" e "ja avaliado" sem tomar 409.
  it('marca podeAvaliar na propria inscricao de atendimento REALIZADO', () => {
    const dto = AtendimentoRespostaDto.deModelo(
      atendimento({ status: StatusAtendimento.REALIZADO, inscricoes: [inscricao()] }),
      { statusAtendimento: StatusAtendimento.REALIZADO, minhaInscricaoId: 'i-1', jaAvaliei: false },
    );

    expect(dto.inscricoes![0]).toMatchObject({ souEu: true, jaAvaliei: false, podeAvaliar: true });
  });

  it('nao permite avaliar de novo quem ja avaliou', () => {
    const dto = AtendimentoRespostaDto.deModelo(
      atendimento({ status: StatusAtendimento.REALIZADO, inscricoes: [inscricao()] }),
      { statusAtendimento: StatusAtendimento.REALIZADO, minhaInscricaoId: 'i-1', jaAvaliei: true },
    );

    expect(dto.inscricoes![0]).toMatchObject({ jaAvaliei: true, podeAvaliar: false });
  });

  it('nao permite avaliar quem faltou', () => {
    const dto = AtendimentoRespostaDto.deModelo(
      atendimento({
        status: StatusAtendimento.REALIZADO,
        inscricoes: [inscricao({ status: StatusInscricao.AUSENTE })],
      }),
      { statusAtendimento: StatusAtendimento.REALIZADO, minhaInscricaoId: 'i-1', jaAvaliei: false },
    );

    expect(dto.inscricoes![0].podeAvaliar).toBe(false);
  });

  /**
   * D-10: a autoria da avaliacao e anonima para o monitor. As marcas so podem
   * aparecer na inscricao do proprio requisitante — se aparecessem nas dos
   * colegas, revelariam quem avaliou.
   */
  it('nao marca as inscricoes dos colegas', () => {
    const dto = AtendimentoRespostaDto.deModelo(
      atendimento({
        status: StatusAtendimento.REALIZADO,
        inscricoes: [inscricao(), inscricao({ id: 'i-2', participanteId: 'v-2' })],
      }),
      { statusAtendimento: StatusAtendimento.REALIZADO, minhaInscricaoId: 'i-1', jaAvaliei: true },
    );

    const colega = dto.inscricoes!.find((i) => i.id === 'i-2')!;
    expect(colega.souEu).toBeUndefined();
    expect(colega.jaAvaliei).toBeUndefined();
    expect(colega.podeAvaliar).toBeUndefined();
  });
});

describe('B5 — reagendamento', () => {
  function montar(sobrescreve: Record<string, unknown> = {}) {
    const alvo = {
      id: 'a-1',
      monitoriaId: 'm-1',
      monitorParticipanteId: 'v-monitor',
      status: StatusAtendimento.AGENDADO,
      inicio: new Date(Date.now() + 24 * 3600_000),
      fim: new Date(Date.now() + 25 * 3600_000),
      update: jest.fn(),
    };

    const atendimentoModel = { findByPk: jest.fn().mockResolvedValue(alvo) };
    const historicoModel = { create: jest.fn() };

    const sequelize = {
      transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb({ LOCK: { UPDATE: 'u' } })),
      query: jest.fn().mockResolvedValue((sobrescreve.conflitantes as unknown[]) ?? []),
    };

    const participacaoService = {
      obterContexto: jest.fn().mockResolvedValue({
        ehProfessorResponsavel: true,
        participacao: null,
        papel: null,
      }),
    };

    const disponibilidadesService = {
      validarJanela: jest.fn().mockResolvedValue(undefined),
      ...((sobrescreve.disponibilidadesService as object) ?? {}),
    };

    return {
      service: new AtendimentosService(
        atendimentoModel as never,
        {} as never,
        historicoModel as never,
        {} as never,
        sequelize as never,
        participacaoService as never,
        {} as never,
        {} as never,
        disponibilidadesService as never,
        { emit: jest.fn() } as never,
        // ConfigService: retornar undefined faz os defaults de D-15 valerem.
        { get: () => undefined } as never,
      ),
      alvo,
      historicoModel,
      disponibilidadesService,
    };
  }

  const dto = {
    inicio: new Date(Date.now() + 48 * 3600_000).toISOString(),
    fim: new Date(Date.now() + 49 * 3600_000).toISOString(),
    motivo: 'Conflito com prova.',
  };

  it('revalida a janela de disponibilidade do monitor no novo horario', async () => {
    const { service, disponibilidadesService } = montar();

    await service.reagendar('a-1', dto, aluno);

    expect(disponibilidadesService.validarJanela).toHaveBeenCalledWith(
      'v-monitor',
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('atualiza inicio/fim e deixa o CASCADE propagar as inscricoes', async () => {
    const { service, alvo } = montar();

    await service.reagendar('a-1', dto, aluno);

    expect(alvo.update).toHaveBeenCalledWith(
      { inicio: new Date(dto.inicio), fim: new Date(dto.fim) },
      expect.anything(),
    );
  });

  /** RN10: o horario anterior nao pode ser sobrescrito sem deixar rastro. */
  it('registra o horario anterior e o motivo no historico', async () => {
    const { service, historicoModel } = montar();

    await service.reagendar('a-1', dto, aluno);

    const registro = historicoModel.create.mock.calls[0][0];
    expect(registro.statusAnterior).toBe(StatusAtendimento.AGENDADO);
    expect(registro.statusNovo).toBe(StatusAtendimento.AGENDADO);
    expect(registro.motivo).toMatch(/Reagendado\. Antes:/);
    expect(registro.motivo).toContain('Conflito com prova.');
  });

  /** D-22: rejeitar informando quem conflita, em vez de remover em silencio. */
  it('recusa quando um inscrito conflita, nomeando quem', async () => {
    const { service } = montar({ conflitantes: [{ nome: 'Ana Martins' }, { nome: 'Bruno Lima' }] });

    await expect(service.reagendar('a-1', dto, aluno)).rejects.toThrow(/Ana Martins, Bruno Lima/);
  });

  it('recusa reagendar atendimento que nao esta AGENDADO', async () => {
    const { service, alvo } = montar();
    alvo.status = StatusAtendimento.REALIZADO;

    await expect(service.reagendar('a-1', dto, aluno)).rejects.toThrow(ConflictException);
  });

  it('recusa novo horario no passado', async () => {
    const { service } = montar();

    await expect(
      service.reagendar(
        'a-1',
        {
          ...dto,
          inicio: new Date(Date.now() - 7200_000).toISOString(),
          fim: new Date(Date.now() - 3600_000).toISOString(),
        },
        aluno,
      ),
    ).rejects.toThrow(/passado/);
  });
});
