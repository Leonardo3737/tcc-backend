import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { PapelMonitoria } from '../../src/common/enums/papel-monitoria.enum';
import { StatusAtendimento } from '../../src/common/enums/status-atendimento.enum';
import { StatusInscricao } from '../../src/common/enums/status-inscricao.enum';
import { StatusMonitoria } from '../../src/common/enums/status-monitoria.enum';
import { StatusParticipacao } from '../../src/common/enums/status-participacao.enum';
import { TipoPontuacao } from '../../src/common/enums/tipo-pontuacao.enum';
import { AtendimentosService } from '../../src/modules/atendimentos/atendimentos.service';
import { GamificacaoService } from '../../src/modules/gamificacao/gamificacao.service';
import { ParticipantesService } from '../../src/modules/monitorias/participantes.service';

/**
 * Ajustes de usabilidade (A1-A4, B1-B2).
 *
 * O foco e o que nao da para ver por inspecao: o recorte de cada filtro, o
 * comportamento do lote sob falha parcial, e a atomicidade da promocao.
 */

const USUARIO = { id: 'u-1', nome: 'Ana', email: 'a@ufx.edu.br', perfis: [] } as never;

function servicoDeAtendimentos(sobrescreve: Record<string, unknown> = {}) {
  const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
  const query = jest.fn().mockResolvedValue((sobrescreve.linhas as unknown[]) ?? []);

  const config = {
    get: jest.fn((chave: string) => {
      const valores: Record<string, unknown> = {
        'agenda.duracaoPadraoMinutos': 60,
        'agenda.duracaoMinimaMinutos': 15,
        'agenda.duracaoMaximaMinutos': 240,
        'agenda.antecedenciaMinimaMinutos': 0,
      };
      return valores[chave];
    }),
    getOrThrow: jest.fn().mockReturnValue('America/Porto_Velho'),
  };

  const service = new AtendimentosService(
    { findAndCountAll } as never,
    { findAll: jest.fn().mockResolvedValue([]) } as never,
    {} as never,
    {} as never,
    { query, literal: jest.fn((sql: string) => sql) } as never,
    {
      listarVinculosDoAluno: jest
        .fn()
        .mockResolvedValue((sobrescreve.vinculos as unknown[]) ?? [{ id: 'mp-1' }]),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    { emit: jest.fn() } as never,
    config as never,
  );

  (service as never as { montarContextosDeAvaliacao: jest.Mock }).montarContextosDeAvaliacao = jest
    .fn()
    .mockResolvedValue(new Map());

  return { service, findAndCountAll, query };
}

describe('A1 — horarios livres', () => {
  const janela = (dias: number) => ({
    de: new Date().toISOString(),
    ate: new Date(Date.now() + dias * 864e5).toISOString(),
  });

  it('recusa janela maior que 60 dias', async () => {
    const { service } = servicoDeAtendimentos();

    await expect(service.horariosLivres('m-1', janela(61), USUARIO)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('aceita janela de exatamente 60 dias', async () => {
    const { service } = servicoDeAtendimentos();

    await expect(service.horariosLivres('m-1', janela(60), USUARIO)).resolves.toBeDefined();
  });

  it('recusa janela invertida', async () => {
    const { service } = servicoDeAtendimentos();

    await expect(service.horariosLivres('m-1', janela(-1), USUARIO)).rejects.toThrow(
      BadRequestException,
    );
  });

  /** Os limites sao configuraveis (D-15): o DTO nao pode fixa-los como literal. */
  it('recusa duracao fora dos limites configurados', async () => {
    const { service } = servicoDeAtendimentos();

    await expect(
      service.horariosLivres('m-1', { ...janela(7), duracaoMinutos: 5 }, USUARIO),
    ).rejects.toThrow(/entre 15 e 240/);
  });

  it('usa a duracao padrao quando nao informada', async () => {
    const { service, query } = servicoDeAtendimentos();

    await service.horariosLivres('m-1', janela(7), USUARIO);

    expect(query.mock.calls[0][1].replacements.duracao).toBe(60);
  });

  /**
   * A subtracao da agenda do SOLICITANTE e o que o cliente nao conseguiria
   * fazer: as inscricoes dele podem estar em monitorias que ele nem pode ler.
   */
  it('subtrai a agenda do solicitante, inclusive de outras monitorias', async () => {
    const { service, query } = servicoDeAtendimentos({
      vinculos: [{ id: 'mp-desta' }, { id: 'mp-de-outra' }],
    });

    await service.horariosLivres('m-1', janela(7), USUARIO);

    const { sql, replacements } = {
      sql: String(query.mock.calls[0][0]),
      replacements: query.mock.calls[0][1].replacements,
    };

    expect(replacements.idsDoSolicitante).toEqual(['mp-desta', 'mp-de-outra']);
    expect(sql).toContain('atendimento_participantes');
    expect(sql).toContain("ap.status IN ('INSCRITO', 'PRESENTE')");
  });

  /** Professor sem perfil de aluno nao tem vinculo: a consulta nao pode quebrar. */
  it('usa sentinela quando o solicitante nao tem vinculo nenhum', async () => {
    const { service, query } = servicoDeAtendimentos({ vinculos: [] });

    await service.horariosLivres('m-1', janela(7), USUARIO);

    expect(query.mock.calls[0][1].replacements.idsDoSolicitante).toEqual([
      '00000000-0000-0000-0000-000000000000',
    ]);
  });

  it('exclui slots ocupados pelo proprio monitor', async () => {
    const { service, query } = servicoDeAtendimentos();

    await service.horariosLivres('m-1', janela(7), USUARIO);

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('a.monitor_participante_id = slots.participante_id');
    expect(sql).toContain("a.status = 'AGENDADO'");
  });

  /** Lista cortada precisa ser sinalizada, senao o cliente conclui que acabou. */
  it('sinaliza truncamento no teto de 500', async () => {
    const linha = {
      inicio: new Date(),
      fim: new Date(),
      monitorParticipanteId: 'mp-1',
      nomeMonitor: 'Ana',
    };
    const { service } = servicoDeAtendimentos({ linhas: Array.from({ length: 501 }, () => linha) });

    const resposta = await service.horariosLivres('m-1', janela(7), USUARIO);

    expect(resposta.truncado).toBe(true);
    expect(resposta.horarios).toHaveLength(500);
  });
});

describe('A4 — filtros de agenda pessoal', () => {
  /** Ignorar em silencio daria uma lista plausivel e um contador errado. */
  it('recusa os filtros em GET /monitorias/:id/atendimentos', async () => {
    const { service } = servicoDeAtendimentos();

    await expect(
      service.listarPorMonitoria('m-1', { aguardandoRegistro: true } as never),
    ).rejects.toThrow(/agenda pessoal/);

    await expect(
      service.listarPorMonitoria('m-1', { pendentesDeAvaliacao: true } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('nao recusa a listagem da monitoria sem esses filtros', async () => {
    const { service } = servicoDeAtendimentos();

    await expect(
      service.listarPorMonitoria('m-1', { pagina: 1, limite: 20, offset: 0 } as never),
    ).resolves.toBeDefined();
  });

  /** Um exige AGENDADO e o outro REALIZADO: juntos devolveriam sempre vazio. */
  it('recusa os dois ao mesmo tempo', async () => {
    const { service } = servicoDeAtendimentos();

    await expect(
      service.meusAtendimentos(USUARIO, {
        aguardandoRegistro: true,
        pendentesDeAvaliacao: true,
      } as never),
    ).rejects.toThrow(/mutuamente exclusivos/);
  });

  it('aguardandoRegistro recorta sessoes ja iniciadas em que o usuario e o monitor', async () => {
    const { service, findAndCountAll } = servicoDeAtendimentos();

    await service.meusAtendimentos(USUARIO, {
      aguardandoRegistro: true,
      pagina: 1,
      limite: 20,
      offset: 0,
    } as never);

    const { where } = findAndCountAll.mock.calls[0][0];

    expect(where.status).toBe(StatusAtendimento.AGENDADO);
    expect(where.monitorParticipanteId).toBeDefined();
    // `Op.lt` e Symbol: comparar com now() prova que so o que ja comecou entra.
    expect(Object.getOwnPropertySymbols(where.inicio)).toHaveLength(1);
  });

  it('pendentesDeAvaliacao usa o mesmo criterio de podeAvaliar', async () => {
    const { service, findAndCountAll } = servicoDeAtendimentos();

    await service.meusAtendimentos(USUARIO, {
      pendentesDeAvaliacao: true,
      pagina: 1,
      limite: 20,
      offset: 0,
    } as never);

    const { where } = findAndCountAll.mock.calls[0][0];
    const sql = String(Object.getOwnPropertySymbols(where).map((s) => where[s])[0]);

    expect(where.status).toBe(StatusAtendimento.REALIZADO);
    expect(sql).toContain("ap.status = 'PRESENTE'");
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('avaliacoes');
  });
});

describe('B2 — regras de pontuacao', () => {
  const service = new GamificacaoService({} as never, {} as never);

  it('expoe um item por tipo', () => {
    expect(service.regras().regras).toHaveLength(Object.values(TipoPontuacao).length);
  });

  it('traz os pontos fixos', () => {
    const porTipo = new Map(service.regras().regras.map((r) => [r.tipo, r.pontos]));

    expect(porTipo.get(TipoPontuacao.ATENDIMENTO_REALIZADO)).toBe(10);
    expect(porTipo.get(TipoPontuacao.PARTICIPACAO_ATENDIMENTO)).toBe(5);
  });

  /**
   * A constante guarda 0 porque o tipo exige um numero; devolver esse 0 faria a
   * tela anunciar que avaliacao nao pontua — o oposto do que acontece.
   */
  it('AVALIACAO_RECEBIDA vem null, nao zero', () => {
    const regra = service.regras().regras.find((r) => r.tipo === TipoPontuacao.AVALIACAO_RECEBIDA)!;

    expect(regra.pontos).toBeNull();
    expect(regra.descricao).toMatch(/nota/i);
  });

  it('toda regra tem descricao', () => {
    expect(service.regras().regras.every((r) => r.descricao.length > 0)).toBe(true);
  });
});

describe('A3 — promocao a monitor', () => {
  function montarPromocao(sobrescreve: Record<string, unknown> = {}) {
    const antigo = {
      id: 'mp-antigo',
      alunoId: 'u-bruno',
      papel: PapelMonitoria.MONITORADO,
      status: StatusParticipacao.ATIVO,
      update: jest.fn(),
      ...((sobrescreve.antigo as object) ?? {}),
    };

    const participanteModel = {
      create: jest.fn().mockImplementation(() => {
        if (sobrescreve.falhaAoCriar) {
          return Promise.reject(new Error('falha no passo 2'));
        }
        return Promise.resolve({ id: 'mp-novo' });
      }),
    };

    const inscricaoModel = {
      update: jest.fn().mockResolvedValue([(sobrescreve.inscricoes as number) ?? 2]),
      count: jest.fn().mockResolvedValue(0),
    };

    const eventos = { emit: jest.fn() };

    const service = new ParticipantesService(
      participanteModel as never,
      {} as never,
      {} as never,
      inscricaoModel as never,
      {
        buscarParticipantePorIdOuFalhar: jest.fn().mockImplementation(() => {
          if (sobrescreve.inexistente) {
            return Promise.reject(new NotFoundException('Participante nao encontrado.'));
          }
          return Promise.resolve(antigo);
        }),
      } as never,
      eventos as never,
      {
        transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb({})),
      } as never,
    );

    (service as never as { detalhar: jest.Mock }).detalhar = jest
      .fn()
      .mockResolvedValue({ id: 'mp-novo' });

    const monitoria = {
      id: 'm-1',
      status: (sobrescreve.statusMonitoria as StatusMonitoria) ?? StatusMonitoria.ATIVA,
    } as never;

    return { service, monitoria, antigo, participanteModel, inscricaoModel, eventos };
  }

  const professor = { id: 'u-prof' } as never;

  it('encerra o vinculo antigo e cria o novo como MONITOR', async () => {
    const { service, monitoria, antigo, participanteModel } = montarPromocao();

    await service.promoverAMonitor(monitoria, 'mp-antigo', professor);

    expect(antigo.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: StatusParticipacao.ENCERRADO }),
      expect.anything(),
    );
    expect(participanteModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ papel: PapelMonitoria.MONITOR, alunoId: 'u-bruno' }),
      expect.anything(),
    );
  });

  /**
   * O defeito que motivou o endpoint: a sequencia manual nao era atomica, e
   * falhando o segundo passo o aluno ficava SEM VINCULO NENHUM — pior que o
   * estado inicial. Tudo tem de acontecer dentro da mesma transacao.
   */
  it('falha ao criar o novo vinculo acontece DENTRO da transacao', async () => {
    const { service, monitoria } = montarPromocao({ falhaAoCriar: true });

    await expect(service.promoverAMonitor(monitoria, 'mp-antigo', professor)).rejects.toThrow(
      'falha no passo 2',
    );
  });

  it('nao emite evento quando a transacao falha', async () => {
    const { service, monitoria, eventos } = montarPromocao({ falhaAoCriar: true });

    await expect(service.promoverAMonitor(monitoria, 'mp-antigo', professor)).rejects.toThrow();

    expect(eventos.emit).not.toHaveBeenCalled();
  });

  /** Opcao (c): as inscricoes antigas saem, e o aviso diz isso. */
  it('cancela as inscricoes do vinculo antigo e informa quantas no evento', async () => {
    const { service, monitoria, inscricaoModel, eventos } = montarPromocao({ inscricoes: 3 });

    await service.promoverAMonitor(monitoria, 'mp-antigo', professor);

    expect(inscricaoModel.update).toHaveBeenCalledWith(
      { status: StatusInscricao.CANCELADA },
      expect.objectContaining({
        where: { participanteId: 'mp-antigo', status: StatusInscricao.INSCRITO },
      }),
    );

    const [, evento] = eventos.emit.mock.calls[0];
    expect(evento.inscricoesCanceladas).toBe(3);
    expect(evento.participanteId).toBe('mp-novo');
  });

  it('recusa quem ja e MONITOR', async () => {
    const { service, monitoria } = montarPromocao({
      antigo: { papel: PapelMonitoria.MONITOR },
    });

    await expect(service.promoverAMonitor(monitoria, 'mp-antigo', professor)).rejects.toThrow(
      ConflictException,
    );
  });

  it('recusa vinculo nao ATIVO', async () => {
    const { service, monitoria } = montarPromocao({
      antigo: { status: StatusParticipacao.ENCERRADO },
    });

    await expect(service.promoverAMonitor(monitoria, 'mp-antigo', professor)).rejects.toThrow(
      ConflictException,
    );
  });

  it('recusa monitoria encerrada', async () => {
    const { service, monitoria } = montarPromocao({
      statusMonitoria: StatusMonitoria.ENCERRADA,
    });

    await expect(service.promoverAMonitor(monitoria, 'mp-antigo', professor)).rejects.toThrow(
      ConflictException,
    );
  });

  it('participante inexistente devolve 404', async () => {
    const { service, monitoria } = montarPromocao({ inexistente: true });

    await expect(service.promoverAMonitor(monitoria, 'mp-x', professor)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('A2 — lote de atendimentos', () => {
  function montarLote(falhas: number[] = []) {
    const eventos = { emit: jest.fn() };
    let criados = 0;

    const atendimentoModel = {
      create: jest.fn().mockImplementation(() => {
        const indice = criados++;

        if (falhas.includes(indice)) {
          return Promise.reject(
            new ConflictException(
              'Este monitor ja possui outro atendimento que se sobrepoe a este horario (RN03).',
            ),
          );
        }

        return Promise.resolve({ id: `a-${indice}` });
      }),
    };

    // Ordem do construtor: atendimento, inscricao, historico, avaliacao,
    // sequelize, participacao, participantes, monitorias, disponibilidades,
    // eventos, config.
    const service = new AtendimentosService(
      atendimentoModel as never,
      { create: jest.fn() } as never,
      { create: jest.fn().mockResolvedValue({ id: 'h-1' }) } as never,
      {} as never,
      {
        transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb({})),
      } as never,
      {} as never,
      {} as never,
      { exigirMonitoriaAtiva: jest.fn() } as never,
      { validarJanela: jest.fn().mockResolvedValue(undefined) } as never,
      eventos as never,
      { get: jest.fn(), getOrThrow: jest.fn() } as never,
    );

    const contexto = {
      monitoria: { id: 'm-1', status: StatusMonitoria.ATIVA },
      papel: PapelMonitoria.MONITOR,
      participacao: { id: 'mp-1' },
      ehProfessorResponsavel: false,
    } as never;

    return { service, contexto, eventos, atendimentoModel };
  }

  function ocorrencias(quantas: number) {
    return Array.from({ length: quantas }, (_, i) => ({
      inicio: new Date(Date.now() + (i + 1) * 864e5).toISOString(),
      fim: new Date(Date.now() + (i + 1) * 864e5 + 3600_000).toISOString(),
    }));
  }

  const corpo = (quantas: number) => ({
    assunto: 'Plantao semanal',
    modalidade: 'PRESENCIAL',
    ocorrencias: ocorrencias(quantas),
  });

  /**
   * O ponto do endpoint: um feriado no meio da serie nao pode derrubar as
   * outras catorze — seria exatamente o problema que ele existe para resolver.
   */
  it('uma ocorrencia conflitante nao derruba as demais', async () => {
    const { service, contexto } = montarLote([2]);

    const resposta = await service.agendarEmLote(contexto, corpo(5) as never, USUARIO);

    expect(resposta.criados).toBe(4);
    expect(resposta.recusados).toBe(1);
    expect(resposta.resultados[2].criado).toBe(false);
    expect(resposta.resultados[2].erro).toContain('RN03');
  });

  it('preserva a ordem de entrada', async () => {
    const { service, contexto } = montarLote([1]);
    const entrada = corpo(4);

    const resposta = await service.agendarEmLote(contexto, entrada as never, USUARIO);

    expect(resposta.resultados.map((r) => r.inicio)).toEqual(
      entrada.ocorrencias.map((o) => o.inicio),
    );
  });

  /**
   * Um evento por ocorrencia significaria, num lote de 16 sessoes com 20
   * monitorados, 320 e-mails de uma vez.
   */
  it('emite UM unico evento para a serie inteira', async () => {
    const { service, contexto, eventos } = montarLote();

    await service.agendarEmLote(contexto, corpo(10) as never, USUARIO);

    expect(eventos.emit).toHaveBeenCalledTimes(1);
  });

  it('o evento aponta a primeira criada e conta as demais', async () => {
    const { service, contexto, eventos } = montarLote([0]);

    await service.agendarEmLote(contexto, corpo(5) as never, USUARIO);

    const [, evento] = eventos.emit.mock.calls[0];

    // A primeira falhou: o aviso referencia a primeira que de fato nasceu.
    expect(evento.atendimentoId).toBe('a-1');
    expect(evento.demaisSessoes).toBe(3);
  });

  it('nenhuma criada: nenhum evento', async () => {
    const { service, contexto, eventos } = montarLote([0, 1, 2]);

    const resposta = await service.agendarEmLote(contexto, corpo(3) as never, USUARIO);

    expect(resposta.criados).toBe(0);
    expect(eventos.emit).not.toHaveBeenCalled();
  });

  /**
   * Absorver qualquer excecao transformaria uma falha de banco em
   * "13 de 15 criados" sem ninguem perceber.
   */
  it('erro que nao e de regra sobe em vez de virar recusa', async () => {
    const { service, contexto, atendimentoModel } = montarLote();
    atendimentoModel.create.mockRejectedValue(new Error('conexao perdida'));

    await expect(service.agendarEmLote(contexto, corpo(3) as never, USUARIO)).rejects.toThrow(
      'conexao perdida',
    );
  });
});
