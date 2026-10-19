import { UniqueConstraintError } from 'sequelize';

import { OrigemAtendimento } from '../../src/common/enums/origem-atendimento.enum';
import { PapelMonitoria } from '../../src/common/enums/papel-monitoria.enum';
import { TipoNotificacao } from '../../src/common/enums/tipo-notificacao.enum';
import {
  AtendimentoCanceladoEvento,
  AtendimentoAgendadoEvento,
  AtendimentoReagendadoEvento,
  MonitorHabilitadoEvento,
} from '../../src/modules/notificacoes/eventos';
import {
  MENSAGENS,
  formatarDataHora,
  formatarHora,
  montarLink,
} from '../../src/modules/notificacoes/mensagens';
import { NotificacoesService } from '../../src/modules/notificacoes/notificacoes.service';

/**
 * Avisos por e-mail.
 *
 * Tres coisas aqui quebrariam em silencio se ninguem travasse: avisar duas
 * vezes, avisar a pessoa errada, e avisar com o horario errado. As duas
 * primeiras sao caras (spam, reputacao do remetente); a terceira e pior que nao
 * avisar, porque a pessoa age com base na informacao errada.
 */

const FUSO = 'America/Porto_Velho'; // UTC-4, igual ao .env do projeto

const ATENDIMENTO = {
  atendimentoId: 'a-1',
  monitoriaId: 'm-1',
  disciplina: 'Banco de Dados',
  inicio: new Date('2026-10-14T19:00:00Z'),
  fim: new Date('2026-10-14T20:00:00Z'),
  modalidade: 'PRESENCIAL',
  local: 'Sala 12',
  monitor: 'Ana Monitora',
  monitorUsuarioId: 'u-monitor',
};

interface Opcoes {
  habilitadas?: boolean;
  emailEntregue?: boolean;
  /** Linhas devolvidas por cada consulta SQL, na ordem em que sao feitas. */
  consultas?: unknown[][];
  colideAoInserir?: boolean;
}

function montar(opcoes: Opcoes = {}) {
  const {
    habilitadas = true,
    emailEntregue = true,
    consultas = [],
    colideAoInserir = false,
  } = opcoes;

  const criadas: Record<string, unknown>[] = [];
  const atualizacoes: Record<string, unknown>[] = [];

  const notificacaoModel = {
    create: jest.fn((dados: Record<string, unknown>) => {
      if (colideAoInserir) {
        return Promise.reject(new UniqueConstraintError({ errors: [] }));
      }

      criadas.push(dados);

      return Promise.resolve({
        ...dados,
        id: `n-${criadas.length}`,
        tentativas: 0,
        update: jest.fn((novos: Record<string, unknown>) => {
          atualizacoes.push(novos);
          return Promise.resolve(undefined);
        }),
      });
    }),
    findAll: jest.fn().mockResolvedValue([]),
  };

  let chamada = 0;
  const sequelize = {
    query: jest.fn(() => Promise.resolve(consultas[chamada++] ?? [])),
  };

  const emailService = { enviar: jest.fn().mockResolvedValue(emailEntregue) };

  const config = {
    get: jest.fn((chave: string) => (chave === 'notificacoes.habilitadas' ? habilitadas : FUSO)),
    getOrThrow: jest.fn((chave: string) =>
      chave === 'app.urlFront' ? 'http://localhost:3001' : FUSO,
    ),
  };

  const service = new NotificacoesService(
    notificacaoModel as never,
    sequelize as never,
    emailService as never,
    config as never,
  );

  return { service, notificacaoModel, sequelize, emailService, criadas, atualizacoes };
}

function destinatario(id: string, nome: string) {
  return { usuarioId: id, nome, email: `${id}@ufx.edu.br` };
}

describe('Formatacao de horario — o erro mais caro do modulo', () => {
  /**
   * Um aviso com o horario errado e pior que aviso nenhum: a pessoa age com
   * base nele. O servidor pode rodar em UTC, e a hora que ela le precisa ser a
   * mesma que aparece na tela do sistema.
   */
  it('usa o fuso da instituicao, nao o do servidor', () => {
    // 19:00 UTC = 15:00 em Porto Velho (UTC-4)
    expect(formatarDataHora(new Date('2026-10-14T19:00:00Z'), FUSO)).toContain('15:00');
    expect(formatarHora(new Date('2026-10-14T20:00:00Z'), FUSO)).toBe('16:00');
  });

  /**
   * A virada do dia e onde o erro aparece. 00:00 UTC do dia 14 ainda e dia 13
   * em Porto Velho — e um lembrete "hoje" enviado com a data errada seria
   * indefensavel.
   */
  it('respeita a virada do dia', () => {
    expect(formatarDataHora(new Date('2026-10-14T00:00:00Z'), FUSO)).toContain('13/10/2026');
  });
});

describe('Mensagens', () => {
  function montarMensagem(tipo: TipoNotificacao, motivo?: string) {
    return MENSAGENS[tipo]({
      nome: 'Bruno',
      dados: ATENDIMENTO,
      fuso: FUSO,
      link: 'http://localhost:3001/atendimentos/a-1',
      motivo,
    });
  }

  it.each(Object.values(TipoNotificacao))('%s produz assunto e corpo nao vazios', (tipo) => {
    const { assunto, corpo } = montarMensagem(tipo, 'motivo qualquer');

    expect(assunto.length).toBeGreaterThan(0);
    expect(corpo).toContain('Bruno');
  });

  it('o assunto cabe na coluna do banco (200)', () => {
    for (const tipo of Object.values(TipoNotificacao)) {
      expect(montarMensagem(tipo, 'x').assunto.length).toBeLessThanOrEqual(200);
    }
  });

  /** Todo aviso precisa levar a pessoa a algum lugar. */
  it.each(Object.values(TipoNotificacao))('%s inclui o link de acesso', (tipo) => {
    expect(montarMensagem(tipo).corpo).toContain('http://localhost:3001/atendimentos/a-1');
  });

  it('o cancelamento informa o motivo', () => {
    const { corpo } = montarMensagem(TipoNotificacao.ATENDIMENTO_CANCELADO, 'Monitor doente');

    expect(corpo).toContain('Monitor doente');
    expect(corpo).toContain('CANCELADO');
  });

  /** O ponto do aviso: a inscricao foi mantida, entao o horario novo e o recado. */
  it('o reagendamento destaca o novo horario e a inscricao preservada', () => {
    const { corpo } = montarMensagem(TipoNotificacao.ATENDIMENTO_REAGENDADO);

    expect(corpo).toContain('15:00');
    expect(corpo.toLowerCase()).toContain('mantida');
  });
});

describe('montarLink — para onde cada aviso leva', () => {
  const BASE = 'http://localhost:3001';
  const IDS = { atendimentoId: 'a-1', monitoriaId: 'm-1' };

  it('avisos de atendimento levam a pagina do atendimento', () => {
    const deAtendimento = Object.values(TipoNotificacao).filter(
      (tipo) => tipo !== TipoNotificacao.MONITOR_HABILITADO,
    );

    for (const tipo of deAtendimento) {
      expect(montarLink(tipo, IDS, BASE)).toBe(`${BASE}/atendimentos/a-1`);
    }
  });

  it('habilitacao de monitor leva a monitoria', () => {
    expect(montarLink(TipoNotificacao.MONITOR_HABILITADO, IDS, BASE)).toBe(
      `${BASE}/monitorias/m-1`,
    );
  });

  /**
   * Link quebrado em e-mail nao tem conserto depois de enviado: sem o id, o
   * destino vira a raiz do sistema, nunca `/atendimentos/undefined`.
   */
  it('sem o id esperado, cai na raiz em vez de gerar URL quebrada', () => {
    expect(montarLink(TipoNotificacao.LEMBRETE_DIA, {}, BASE)).toBe(BASE);
    expect(montarLink(TipoNotificacao.MONITOR_HABILITADO, {}, BASE)).toBe(BASE);
    expect(montarLink(TipoNotificacao.LEMBRETE_DIA, {}, BASE)).not.toContain('undefined');
  });

  it('barra final na base nao produz barra dupla', () => {
    expect(montarLink(TipoNotificacao.LEMBRETE_DIA, IDS, 'http://x.com/')).toBe(
      'http://x.com/atendimentos/a-1',
    );
    expect(montarLink(TipoNotificacao.LEMBRETE_DIA, IDS, 'http://x.com///')).toBe(
      'http://x.com/atendimentos/a-1',
    );
  });
});

describe('Desabilitado por configuracao', () => {
  /**
   * O padrao e desligado, e precisa ser respeitado em TODOS os gatilhos: ligar
   * sem querer numa base de testes dispara e-mail para enderecos inexistentes.
   */
  it('nenhum gatilho produz nada', async () => {
    const { service, notificacaoModel, emailService } = montar({ habilitadas: false });

    await service.aoCancelar(
      new AtendimentoCanceladoEvento('a-1', 'h-1', 'motivo', 'u-x', ['u-bruno']),
    );
    await service.aoReagendar(new AtendimentoReagendadoEvento('a-1', 'h-1', 'u-x'));
    await service.aoHabilitarMonitor(new MonitorHabilitadoEvento('p-1', 'm-1', 'u-1'));
    await service.lembrarAtendimentosDeHoje();
    await service.reenviarPendentes();

    expect(notificacaoModel.create).not.toHaveBeenCalled();
    expect(emailService.enviar).not.toHaveBeenCalled();
  });
});

describe('Cancelamento', () => {
  /**
   * Os inscritos NAO vem de consulta: quando este ouvinte roda, as inscricoes
   * ja foram canceladas junto com o atendimento e nao ha `INSCRITO` no banco.
   * A lista chega pelo evento, colhida antes do update.
   */
  function cenario(colideAoInserir = false) {
    return montar({
      colideAoInserir,
      consultas: [
        [ATENDIMENTO], // contexto do atendimento
        [destinatario('u-monitor', 'Ana Monitora'), destinatario('u-bruno', 'Bruno')],
      ],
    });
  }

  function cancelamento(autor = 'u-x', inscritos = ['u-bruno']) {
    return new AtendimentoCanceladoEvento('a-1', 'h-1', 'Monitor doente', autor, inscritos);
  }

  it('avisa inscritos e monitor', async () => {
    const { service, criadas } = cenario();

    await service.aoCancelar(cancelamento());

    expect(criadas.map((c) => c.usuarioId).sort()).toEqual(['u-bruno', 'u-monitor']);
    expect(criadas.every((c) => c.tipo === TipoNotificacao.ATENDIMENTO_CANCELADO)).toBe(true);
  });

  /**
   * A regressao que originou esta mudanca. `cancelar` zera as inscricoes dentro
   * da transacao, antes de emitir o evento; consultar `status = 'INSCRITO'`
   * aqui devolvia zero e so o monitor era avisado — justamente quem nao ia se
   * deslocar.
   */
  it('REGRESSAO: quem estava inscrito e avisado, mesmo com a inscricao ja cancelada', async () => {
    const { service, criadas, sequelize } = cenario();

    await service.aoCancelar(cancelamento('u-x', ['u-bruno']));

    expect(criadas.map((c) => c.usuarioId)).toContain('u-bruno');

    // Nenhuma consulta pode filtrar por INSCRITO: nesse instante nao ha nenhum.
    const sqls = sequelize.query.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(sqls.some((sql) => sql.includes("ap.status = 'INSCRITO'"))).toBe(false);
  });

  /**
   * O pior caso do defeito antigo: com o monitor como autor, ele era excluido
   * e os inscritos nao apareciam na consulta — ninguem recebia nada.
   */
  it('REGRESSAO: monitor cancelando ainda avisa os inscritos', async () => {
    const { service, criadas } = cenario();

    await service.aoCancelar(cancelamento('u-monitor', ['u-bruno']));

    expect(criadas.map((c) => c.usuarioId)).toEqual(['u-bruno']);
  });

  it('sem inscritos, so o monitor e avisado', async () => {
    const { service, criadas } = montar({
      consultas: [[ATENDIMENTO], [destinatario('u-monitor', 'Ana Monitora')]],
    });

    await service.aoCancelar(cancelamento('u-x', []));

    expect(criadas.map((c) => c.usuarioId)).toEqual(['u-monitor']);
  });

  /**
   * A chave de idempotencia e o HISTORICO, nao o atendimento. Usar o
   * atendimento faria o segundo reagendamento ser descartado como duplicata —
   * o sistema acharia que avisou e ninguem receberia o novo horario.
   */
  it('referencia a linha de historico, nao o atendimento', async () => {
    const { service, criadas } = cenario();

    await service.aoCancelar(cancelamento());

    expect(criadas.every((c) => c.referenciaId === 'h-1')).toBe(true);
  });

  it('quem cancelou nao recebe aviso do proprio ato', async () => {
    const { service, criadas } = cenario();

    await service.aoCancelar(
      new AtendimentoCanceladoEvento('a-1', 'h-1', 'motivo', 'u-monitor', ['u-bruno']),
    );

    expect(criadas.map((c) => c.usuarioId)).toEqual(['u-bruno']);
  });

  /** Reservar antes de enviar e o que torna o envio unico sob concorrencia. */
  it('colisao na reserva significa "ja avisado": nao envia', async () => {
    const { service, emailService } = cenario(true);

    await service.aoCancelar(cancelamento());

    expect(emailService.enviar).not.toHaveBeenCalled();
  });
});

describe('Agendamento — a origem decide quem recebe', () => {
  it('solicitacao do aluno avisa o MONITOR', async () => {
    const { service, criadas } = montar({
      consultas: [[ATENDIMENTO], [destinatario('u-monitor', 'Ana')]],
    });

    await service.aoAgendar(
      new AtendimentoAgendadoEvento('a-1', 'm-1', OrigemAtendimento.SOLICITACAO_ALUNO, 'u-bruno'),
    );

    expect(criadas).toHaveLength(1);
    expect(criadas[0].tipo).toBe(TipoNotificacao.ATENDIMENTO_SOLICITADO);
    expect(criadas[0].usuarioId).toBe('u-monitor');
  });

  it('oferta do monitor avisa os MONITORADOS', async () => {
    const { service, criadas } = montar({
      consultas: [
        [ATENDIMENTO],
        [destinatario('u-bruno', 'Bruno'), destinatario('u-carla', 'Carla')],
      ],
    });

    await service.aoAgendar(
      new AtendimentoAgendadoEvento('a-1', 'm-1', OrigemAtendimento.OFERTA_MONITOR, 'u-monitor'),
    );

    expect(criadas.map((c) => c.usuarioId)).toEqual(['u-bruno', 'u-carla']);
    expect(criadas.every((c) => c.tipo === TipoNotificacao.ATENDIMENTO_OFERTADO)).toBe(true);
  });
});

describe('Habilitacao de monitor', () => {
  it('avisa o aluno promovido, referenciando o vinculo', async () => {
    const { service, criadas } = montar({
      consultas: [[{ disciplina: 'Calculo I' }], [destinatario('u-ana', 'Ana')]],
    });

    await service.aoHabilitarMonitor(new MonitorHabilitadoEvento('p-1', 'm-1', 'u-ana'));

    expect(criadas).toHaveLength(1);
    expect(criadas[0]).toMatchObject({
      tipo: TipoNotificacao.MONITOR_HABILITADO,
      referenciaId: 'p-1',
      usuarioId: 'u-ana',
    });
    expect(String(criadas[0].corpo)).toContain('disponibilidade');
  });
});

describe('Entrega e reenvio', () => {
  it('marca enviadoEm quando o provedor aceita', async () => {
    const { service, atualizacoes } = montar({
      emailEntregue: true,
      consultas: [[ATENDIMENTO], [destinatario('u-bruno', 'Bruno')], []],
    });

    await service.aoCancelar(
      new AtendimentoCanceladoEvento('a-1', 'h-1', 'motivo', 'u-x', ['u-bruno']),
    );

    expect(atualizacoes[0]).toMatchObject({ tentativas: 1, enviadoEm: expect.any(Date) });
  });

  /**
   * A linha fica com `enviadoEm` nulo e o corpo gravado — e o que permite a
   * rotina de reenvio recolher depois, sem reconstruir a mensagem.
   */
  it('conta a tentativa e NAO marca enviadoEm quando o provedor recusa', async () => {
    const { service, atualizacoes } = montar({
      emailEntregue: false,
      consultas: [[ATENDIMENTO], [destinatario('u-bruno', 'Bruno')], []],
    });

    await service.aoCancelar(
      new AtendimentoCanceladoEvento('a-1', 'h-1', 'motivo', 'u-x', ['u-bruno']),
    );

    expect(atualizacoes[0]).toEqual({ tentativas: 1 });
  });

  it('o corpo gravado e o mesmo que vai no e-mail', async () => {
    const { service, criadas, emailService } = montar({
      consultas: [[ATENDIMENTO], [destinatario('u-bruno', 'Bruno')], []],
    });

    await service.aoCancelar(
      new AtendimentoCanceladoEvento('a-1', 'h-1', 'motivo', 'u-x', ['u-bruno']),
    );

    expect(emailService.enviar.mock.calls[0][0].texto).toBe(criadas[0].corpo);
  });
});

describe('Falha isolada', () => {
  /**
   * Os ouvintes rodam fora da requisicao que os originou: uma excecao aqui nao
   * tem para onde subir e viraria unhandledRejection, derrubando o processo.
   * Um atendimento cancelado continua cancelado mesmo que o aviso falhe.
   */
  it('erro na consulta nao escapa do modulo', async () => {
    const { service } = montar();
    (service as never as { sequelize: { query: jest.Mock } }).sequelize.query = jest
      .fn()
      .mockRejectedValue(new Error('banco fora'));

    await expect(
      service.aoCancelar(
        new AtendimentoCanceladoEvento('a-1', 'h-1', 'motivo', 'u-x', ['u-bruno']),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('O link que chega no corpo despachado', () => {
  it('aviso de atendimento aponta para o atendimento, nao para a referencia', async () => {
    const { service, criadas } = montar({
      consultas: [[ATENDIMENTO], [destinatario('u-bruno', 'Bruno')], []],
    });

    await service.aoCancelar(
      new AtendimentoCanceladoEvento('a-1', 'h-1', 'motivo', 'u-x', ['u-bruno']),
    );

    /**
     * A distincao que importa: `referencia_id` e a linha de historico (h-1),
     * mas o LINK precisa levar ao atendimento (a-1). Uma URL /atendimentos/h-1
     * daria 404 para quem clicasse.
     */
    expect(criadas[0].referenciaId).toBe('h-1');
    expect(String(criadas[0].corpo)).toContain('/atendimentos/a-1');
    expect(String(criadas[0].corpo)).not.toContain('h-1');
  });

  it('habilitacao de monitor aponta para a monitoria', async () => {
    const { service, criadas } = montar({
      consultas: [[{ disciplina: 'Calculo I' }], [destinatario('u-ana', 'Ana')]],
    });

    await service.aoHabilitarMonitor(new MonitorHabilitadoEvento('p-1', 'm-1', 'u-ana'));

    expect(String(criadas[0].corpo)).toContain('/monitorias/m-1');
  });
});

/**
 * O mesmo fato, dois textos.
 *
 * O defeito que isto evita e concreto: dizer "cancele sua inscricao" a quem
 * CONDUZ o atendimento e instrucao impossivel — ele nao tem inscricao — e
 * informar "Monitor(a): Ana" num e-mail enderecado a Ana denuncia uma mensagem
 * escrita para outra pessoa.
 */
describe('LEMBRETE_DIA — monitor e monitorado recebem textos diferentes', () => {
  function lembrete(papel?: PapelMonitoria, inscritos?: number) {
    return MENSAGENS[TipoNotificacao.LEMBRETE_DIA]({
      nome: papel === PapelMonitoria.MONITOR ? 'Ana Monitora' : 'Bruno',
      dados: ATENDIMENTO,
      fuso: FUSO,
      link: 'http://localhost:3001/atendimentos/a-1',
      papel,
      inscritos,
    });
  }

  it('ao monitorado: mostra quem e o monitor e como desistir', () => {
    const { assunto, corpo } = lembrete(PapelMonitoria.MONITORADO);

    expect(assunto).toContain('você tem atendimento hoje');
    expect(corpo).toContain('Monitor(a): Ana Monitora');
    expect(corpo).toContain('cancele sua inscrição');
  });

  it('ao monitor: omite a linha do monitor e nao manda cancelar inscricao', () => {
    const { assunto, corpo } = lembrete(PapelMonitoria.MONITOR, 3);

    expect(assunto).toContain('você conduz um atendimento hoje');
    expect(corpo).not.toContain('Monitor(a):');
    expect(corpo).not.toContain('cancele sua inscrição');
  });

  /** O dado que muda o que o monitor faz: preparar para um ou para oito. */
  it('ao monitor: informa quantos inscritos', () => {
    expect(lembrete(PapelMonitoria.MONITOR, 3).corpo).toContain('Inscritos: 3');
  });

  it('ao monitor sem ninguem inscrito: diz isso em palavras e sugere cancelar', () => {
    const { corpo } = lembrete(PapelMonitoria.MONITOR, 0);

    expect(corpo).toContain('nenhum até agora');
    expect(corpo).toContain('cancelar');
    expect(corpo).not.toContain('Inscritos: 0');
  });

  /** Sem papel informado, cai no texto do monitorado — o caso mais comum. */
  it('sem papel, usa o texto do monitorado', () => {
    expect(lembrete().corpo).toContain('cancele sua inscrição');
  });

  it('os dois textos mantem data, disciplina e link', () => {
    for (const papel of [PapelMonitoria.MONITOR, PapelMonitoria.MONITORADO]) {
      const { corpo } = lembrete(papel, 2);

      expect(corpo).toContain('Banco de Dados');
      expect(corpo).toContain('15:00');
      expect(corpo).toContain('/atendimentos/a-1');
    }
  });
});

describe('O despacho do lembrete separa os dois lados', () => {
  it('monitor e inscritos recebem em despachos distintos, com papeis distintos', async () => {
    const { service, criadas } = montar({
      consultas: [
        [{ id: 'a-1' }], // atendimentos de hoje
        [ATENDIMENTO], // contexto
        [destinatario('u-bruno', 'Bruno'), destinatario('u-carla', 'Carla')], // inscritos
        [destinatario('u-monitor', 'Ana Monitora')], // monitor
      ],
    });

    await service.lembrarAtendimentosDeHoje();

    const porUsuario = new Map(criadas.map((c) => [c.usuarioId, String(c.corpo)]));

    expect(porUsuario.get('u-monitor')).toContain('Inscritos: 2');
    expect(porUsuario.get('u-monitor')).not.toContain('cancele sua inscrição');
    expect(porUsuario.get('u-bruno')).toContain('cancele sua inscrição');
    expect(porUsuario.get('u-carla')).toContain('cancele sua inscrição');
  });
});
