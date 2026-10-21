import { ConflictException, NotFoundException } from '@nestjs/common';

import { PerfilUsuario } from '../../src/common/enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../../src/common/types/usuario-autenticado';
import { AprovacaoDeInscricaoService } from '../../src/modules/editais/aprovacao-de-inscricao.service';

/**
 * APROVACAO de candidatura — onde a selecao vira monitoria.
 *
 * E a operacao com mais consequencias do modulo: cria identidade, cria
 * monitoria e habilita um monitor, atravessando tres modulos. Por isso o que
 * estes testes afirmam nao e "funciona", e sim as decisoes que, se desfeitas
 * por engano, nao fariam nada falhar:
 *
 *  - a conta EXISTENTE e reaproveitada, nunca recriada nem alterada;
 *  - o professor responsavel e o AUTENTICADO, nao o indicado pelo candidato;
 *  - ano e semestre vem do EDITAL, nao do relogio;
 *  - a monitoria da oferta e REUSADA, que e o que permite aprovar o segundo
 *    candidato de uma disciplina;
 *  - o vinculo e criado por `habilitarMonitor`, nao na mao — e ele que carrega
 *    RN01, RN09 e a checagem de curso.
 */

const PROFESSOR_AUTENTICADO: UsuarioAutenticado = {
  id: 'prof-autenticado',
  nome: 'Prof Carlos',
  email: 'carlos@ufx.edu.br',
  perfis: [PerfilUsuario.PROFESSOR],
};

const EDITAL = { id: 'ed-1', ano: 2026, semestre: 2 };

const INSCRICAO = {
  id: 'insc-1',
  editalId: EDITAL.id,
  nomeCompleto: 'Maria Oliveira dos Santos',
  matricula: '2021001234',
  email: 'maria@ufx.edu.br',
  cursoId: 'curso-1',
  disciplinaId: 'disc-1',
  /** O professor que o CANDIDATO indicou. Nao e quem assume a monitoria. */
  professorId: 'prof-indicado',
  edital: EDITAL,
};

function montar(
  opcoes: {
    inscricao?: Record<string, unknown> | null;
    usuarioExistente?: Record<string, unknown> | null;
    /**
     * A monitoria da oferta, se existir. `uq_monitoria_oferta` garante no
     * maximo uma, entao o duble tambem devolve no maximo uma — e so assim o
     * teste reflete o que o banco permite.
     */
    monitoriaDaOferta?: Record<string, unknown> | null;
    donoDaMatricula?: Record<string, unknown> | null;
  } = {},
) {
  const {
    inscricao = INSCRICAO,
    usuarioExistente = null,
    monitoriaDaOferta = null,
    donoDaMatricula = null,
  } = opcoes;

  const ordem: string[] = [];

  const inscricaoModel = { findByPk: jest.fn().mockResolvedValue(inscricao) };

  /** Dono da matricula, quando o teste quer o conflito. Ver `exigirMatriculaLivre`. */
  const alunoModel = { findOne: jest.fn().mockResolvedValue(donoDaMatricula) };

  const monitoriaModel = {
    findOne: jest.fn().mockResolvedValue(monitoriaDaOferta),
    findByPk: jest
      .fn()
      .mockResolvedValue({ id: 'mon-nova', disciplinaId: 'disc-1', ano: 2026, semestre: 2 }),
  };

  const alunoExistente = usuarioExistente?.aluno as Record<string, unknown> | undefined;

  const usuariosService = {
    buscarPorEmailComPerfis: jest.fn().mockImplementation(() => {
      ordem.push('buscaConta');
      return Promise.resolve(usuarioExistente);
    }),
    criarAlunoComoProfessor: jest.fn().mockImplementation(() => {
      ordem.push('criaConta');
      return Promise.resolve({
        id: 'u-nova',
        nome: INSCRICAO.nomeCompleto,
        email: INSCRICAO.email,
      });
    }),
  };

  const monitoriasService = {
    criar: jest.fn().mockImplementation(() => {
      ordem.push('criaMonitoria');
      return Promise.resolve({ id: 'mon-nova' });
    }),
  };

  const participantesService = {
    habilitarMonitor: jest.fn().mockImplementation(() => {
      ordem.push('habilita');
      return Promise.resolve({ id: 'part-1' });
    }),
  };

  /**
   * Quando a conta e criada, a segunda busca por e-mail tem de encontra-la —
   * e o que o service faz para obter a linha de `alunos` recem-inserida.
   */
  if (!usuarioExistente) {
    usuariosService.buscarPorEmailComPerfis.mockImplementation(() => {
      ordem.push('buscaConta');
      const jaCriou = usuariosService.criarAlunoComoProfessor.mock.calls.length > 0;

      return Promise.resolve(
        jaCriou
          ? {
              id: 'u-nova',
              nome: INSCRICAO.nomeCompleto,
              email: INSCRICAO.email,
              ativo: true,
              aluno: { usuarioId: 'u-nova', cursoId: INSCRICAO.cursoId },
            }
          : null,
      );
    });
  }

  return {
    service: new AprovacaoDeInscricaoService(
      inscricaoModel as never,
      monitoriaModel as never,
      alunoModel as never,
      usuariosService as never,
      monitoriasService as never,
      participantesService as never,
    ),
    inscricaoModel,
    monitoriaModel,
    usuariosService,
    monitoriasService,
    participantesService,
    alunoModel,
    alunoExistente,
    ordem,
  };
}

/**
 * Monitoria que ja existe para a oferta. `update` e espionado porque a ADOCAO
 * grava `edital_id` — e e a unica escrita que a aprovacao faz em um registro
 * que outra pessoa criou.
 */
function ofertaExistente(sobrescrever: Record<string, unknown> = {}) {
  return {
    id: 'mon-existente',
    disciplinaId: 'disc-1',
    ano: 2026,
    semestre: 2,
    editalId: null,
    status: 'PLANEJADA',
    update: jest.fn(),
    ...sobrescrever,
  };
}

function contaDeAluno(sobrescrever: Record<string, unknown> = {}) {
  return {
    id: 'u-existente',
    nome: 'Maria O. Santos',
    email: INSCRICAO.email,
    ativo: true,
    aluno: { usuarioId: 'u-existente', cursoId: INSCRICAO.cursoId },
    ...sobrescrever,
  };
}

describe('AprovacaoDeInscricaoService — a inscricao e a unica entrada', () => {
  it('404 quando a inscricao nao existe', async () => {
    const { service } = montar({ inscricao: null });

    await expect(service.aprovar('insc-1', PROFESSOR_AUTENTICADO)).rejects.toThrow(
      NotFoundException,
    );
  });

  /**
   * Nada e redigitado: nome, e-mail, matricula e curso saem da inscricao. E o
   * que impede a conta do monitor nascer divergente da candidatura aprovada.
   */
  it('cria a conta com os dados da inscricao e autoria de quem aprovou', async () => {
    const { service, usuariosService } = montar();

    await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(usuariosService.criarAlunoComoProfessor).toHaveBeenCalledWith(
      {
        nome: INSCRICAO.nomeCompleto,
        email: INSCRICAO.email,
        matricula: INSCRICAO.matricula,
        cursoId: INSCRICAO.cursoId,
      },
      PROFESSOR_AUTENTICADO.id,
    );
  });

  /**
   * A conta e resolvida pelo e-mail, mas a matricula tambem e unica. Inscrito
   * com e-mail diferente do da conta que ja tem, o candidato cairia em
   * `alunos_matricula_key` — recusa verdadeira que nao diz o que fazer. A
   * mensagem daqui nomeia o e-mail que ocupa a matricula.
   */
  it('409 nomeando a conta quando a matricula ja pertence a outro e-mail', async () => {
    const { service, usuariosService } = montar({
      donoDaMatricula: { usuarioId: 'u-outro', usuario: { email: 'outro@ufx.edu.br' } },
    });

    await expect(service.aprovar('insc-1', PROFESSOR_AUTENTICADO)).rejects.toThrow(
      /outro@ufx\.edu\.br/,
    );
    expect(usuariosService.criarAlunoComoProfessor).not.toHaveBeenCalled();
  });

  /** Matricula livre nao atrapalha o caminho normal. */
  it('cria normalmente quando a matricula esta livre', async () => {
    const { service, alunoModel, usuariosService } = montar();

    await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(alunoModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { matricula: INSCRICAO.matricula } }),
    );
    expect(usuariosService.criarAlunoComoProfessor).toHaveBeenCalled();
  });

  it('marca contaCriada quando a conta nasceu agora', async () => {
    const { service } = montar();

    const resposta = await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(resposta.monitor.contaCriada).toBe(true);
    expect(resposta.monitor.usuarioId).toBe('u-nova');
  });
});

describe('AprovacaoDeInscricaoService — conta que ja existe', () => {
  /** A exigencia do escopo: e-mail que ja existe nao gera aluno novo. */
  it('reaproveita a conta e NAO cria aluno de novo', async () => {
    const { service, usuariosService } = montar({ usuarioExistente: contaDeAluno() });

    const resposta = await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(usuariosService.criarAlunoComoProfessor).not.toHaveBeenCalled();
    expect(resposta.monitor.contaCriada).toBe(false);
    expect(resposta.monitor.usuarioId).toBe('u-existente');
  });

  /**
   * O nome da RESPOSTA e o da conta, nao o da inscricao. A pessoa pode ter
   * corrigido o proprio nome depois de se inscrever; a conta e a fonte viva.
   */
  it('usa o nome e o e-mail da conta existente', async () => {
    const { service } = montar({ usuarioExistente: contaDeAluno({ nome: 'Maria Corrigida' }) });

    const resposta = await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(resposta.monitor.nome).toBe('Maria Corrigida');
  });

  /**
   * Conta sem perfil ALUNO e tipicamente de um docente. Promove-la a monitor
   * por efeito colateral de uma aprovacao seria criar identidade de aluno sem
   * ninguem pedir.
   */
  it('409 quando o e-mail pertence a conta sem perfil ALUNO', async () => {
    const { service, participantesService } = montar({
      usuarioExistente: contaDeAluno({ aluno: undefined }),
    });

    await expect(service.aprovar('insc-1', PROFESSOR_AUTENTICADO)).rejects.toThrow(
      /sem perfil ALUNO/,
    );
    expect(participantesService.habilitarMonitor).not.toHaveBeenCalled();
  });

  /** Monitor que nao consegue entrar na plataforma nao e monitor. */
  it('409 quando a conta existente esta inativa', async () => {
    const { service } = montar({ usuarioExistente: contaDeAluno({ ativo: false }) });

    await expect(service.aprovar('insc-1', PROFESSOR_AUTENTICADO)).rejects.toThrow(/inativa/);
  });

  /**
   * O curso do aluno NAO e sobrescrito pelo da inscricao. Divergindo, quem
   * recusa e a FK composta do vinculo, por `exigirCursoCompativel` — reescrever
   * o curso de alguem a partir de um formulario publico seria bem pior.
   */
  it('nao altera nada da conta reaproveitada', async () => {
    const atualizar = jest.fn();
    const { service } = montar({
      usuarioExistente: contaDeAluno({
        update: atualizar,
        aluno: { usuarioId: 'u-existente', cursoId: 'curso-OUTRO', update: atualizar },
      }),
    });

    await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(atualizar).not.toHaveBeenCalled();
  });
});

describe('AprovacaoDeInscricaoService — a monitoria', () => {
  /**
   * O periodo vem do EDITAL. Usar a data de hoje faria uma aprovacao feita em
   * janeiro cair no semestre errado.
   */
  it('cria com ano e semestre do edital e com editalId preenchido', async () => {
    const { service, monitoriasService } = montar();

    await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    const [dto, editalId] = monitoriasService.criar.mock.calls[0];

    expect(dto).toMatchObject({ disciplinaId: 'disc-1', ano: 2026, semestre: 2 });
    expect(editalId).toBe(EDITAL.id);
  });

  /**
   * O responsavel e o professor que o CANDIDATO indicou — ele e quem vai
   * supervisionar a disciplina. Quem aprova age como banca.
   *
   * Afirmado nos DOIS pontos em que o valor aparece: na criacao e na busca de
   * reaproveitamento. Se so a criacao usasse o indicado, a busca procuraria a
   * oferta do professor errado, nao a encontraria, e a segunda aprovacao da
   * disciplina tentaria criar uma monitoria que `uq_monitoria_oferta` recusa.
   */
  it('o responsavel e o professor INDICADO na inscricao, nao quem aprova', async () => {
    const { service, monitoriasService, monitoriaModel } = montar();

    await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    const [dto] = monitoriasService.criar.mock.calls[0];
    expect((dto as { professorId: string }).professorId).toBe(INSCRICAO.professorId);
    expect((dto as { professorId: string }).professorId).not.toBe(PROFESSOR_AUTENTICADO.id);

    const [{ where }] = monitoriaModel.findOne.mock.calls[0];
    expect(where.professorId).toBe(INSCRICAO.professorId);
  });

  /**
   * O ato, porem, continua sendo de quem aprovou: `habilitadoPorUsuarioId` sai
   * do professor autenticado, nao do responsavel. E o que mantem a RN01
   * auditavel neste caminho, em que ela nao e reaplicada.
   */
  it('quem habilita o monitor e o professor autenticado', async () => {
    const { service, participantesService } = montar({ usuarioExistente: contaDeAluno() });

    await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    const [, , quemHabilitou] = participantesService.habilitarMonitor.mock.calls[0];
    expect(quemHabilitou).toBe(PROFESSOR_AUTENTICADO);
  });

  it('CRIADA quando nao existe monitoria para a oferta', async () => {
    const { service } = montar();

    const resposta = await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(resposta.monitoria).toMatchObject({ id: 'mon-nova', origem: 'CRIADA' });
  });

  /**
   * Reaproveitar nao e otimizacao: `uq_monitoria_oferta` torna impossivel uma
   * segunda monitoria da mesma oferta, entao sem reuso a disciplina com duas
   * vagas travaria em 409 na segunda aprovacao.
   */
  it('REUSADA quando a monitoria da oferta ja veio deste edital', async () => {
    const existente = ofertaExistente({ editalId: EDITAL.id });
    const { service, monitoriasService, participantesService } = montar({
      monitoriaDaOferta: existente,
    });

    const resposta = await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(monitoriasService.criar).not.toHaveBeenCalled();
    expect(resposta.monitoria).toMatchObject({ id: 'mon-existente', origem: 'REUSADA' });
    expect(existente.update).not.toHaveBeenCalled();
    expect(participantesService.habilitarMonitor).toHaveBeenCalledWith(
      existente,
      expect.any(String),
      PROFESSOR_AUTENTICADO,
    );
  });

  /**
   * O professor que abre a monitoria a mao antes de rodar a selecao e um fluxo
   * legitimo. A oferta e a MESMA — mesma disciplina, professor e periodo —, e
   * recusar ali pediria trabalho manual sem razao de dominio.
   */
  it('ADOTADA quando a oferta existe sem edital: grava edital_id e usa', async () => {
    const existente = ofertaExistente();
    const { service, monitoriasService } = montar({ monitoriaDaOferta: existente });

    const resposta = await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(monitoriasService.criar).not.toHaveBeenCalled();
    expect(existente.update).toHaveBeenCalledWith({ editalId: EDITAL.id });
    expect(resposta.monitoria).toMatchObject({ id: 'mon-existente', origem: 'ADOTADA' });
  });

  /**
   * A adocao toca UMA coluna. Dono, disciplina, periodo e status ficam como
   * estavam — adotar nao e assumir a monitoria de ninguem.
   */
  it('a adocao grava so o edital_id, nada mais', async () => {
    const existente = ofertaExistente();
    const { service } = montar({ monitoriaDaOferta: existente });

    await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    const [dados] = existente.update.mock.calls[0];
    expect(Object.keys(dados as object)).toEqual(['editalId']);
  });

  /**
   * Monitoria de OUTRO edital nao se adota: ela e o resultado de outro processo
   * seletivo, e reescrever a procedencia apagaria esse fato.
   */
  it('409 quando a oferta veio de outro edital', async () => {
    const existente = ofertaExistente({ editalId: 'ed-OUTRO' });
    const { service, monitoriasService } = montar({ monitoriaDaOferta: existente });

    await expect(service.aprovar('insc-1', PROFESSOR_AUTENTICADO)).rejects.toThrow(
      /veio de outro edital/,
    );
    expect(existente.update).not.toHaveBeenCalled();
    expect(monitoriasService.criar).not.toHaveBeenCalled();
  });

  /**
   * A checagem de status vem ANTES da adocao. Adotar primeiro gravaria
   * `edital_id` em uma monitoria que nao aceita participante, e o resumo
   * passaria a mostrar "monitoria aberta, monitor pendente" — estado que sugere
   * "tente de novo" quando nenhuma tentativa vai funcionar.
   */
  it.each(['ENCERRADA', 'CANCELADA'])('409 sem adotar quando a oferta esta %s', async (status) => {
    const existente = ofertaExistente({ status });
    const { service, participantesService } = montar({ monitoriaDaOferta: existente });

    await expect(service.aprovar('insc-1', PROFESSOR_AUTENTICADO)).rejects.toThrow(
      new RegExp(status.toLowerCase()),
    );
    expect(existente.update).not.toHaveBeenCalled();
    expect(participantesService.habilitarMonitor).not.toHaveBeenCalled();
  });
});

describe('AprovacaoDeInscricaoService — o vinculo e a ordem dos passos', () => {
  /**
   * O vinculo NAO e montado aqui. `habilitarMonitor` carrega a RN01 (registra
   * quem habilitou), a RN09, a recusa de monitoria encerrada, a checagem de
   * curso compativel e o evento que avisa o aluno. Criar a linha na mao
   * perderia tudo isso sem nada falhar.
   */
  it('habilita por habilitarMonitor, com o id do usuario e quem aprovou', async () => {
    const { service, participantesService } = montar({ usuarioExistente: contaDeAluno() });

    const resposta = await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(participantesService.habilitarMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mon-nova' }),
      'u-existente',
      PROFESSOR_AUTENTICADO,
    );
    expect(resposta.monitor.participanteId).toBe('part-1');
  });

  /**
   * A ordem e o que torna a operacao REPETIVEL: os dois primeiros passos sao
   * "encontrar ou criar" e o irrepetivel vem por ultimo. Falhando no meio,
   * chamar de novo retoma de onde parou — e e so por isso que os tres commits
   * separados sao aceitaveis.
   */
  it('conta, depois monitoria, depois vinculo', async () => {
    const { service, ordem } = montar();

    await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(ordem.filter((passo) => passo !== 'buscaConta')).toEqual([
      'criaConta',
      'criaMonitoria',
      'habilita',
    ]);
  });

  /** Falha antes do vinculo nao deixa monitor pela metade. */
  it('nao habilita quando a conta nao pode ser usada', async () => {
    const { service, monitoriasService, participantesService } = montar({
      usuarioExistente: contaDeAluno({ ativo: false }),
    });

    await expect(service.aprovar('insc-1', PROFESSOR_AUTENTICADO)).rejects.toThrow(
      ConflictException,
    );

    expect(monitoriasService.criar).not.toHaveBeenCalled();
    expect(participantesService.habilitarMonitor).not.toHaveBeenCalled();
  });

  it('devolve o id da inscricao aprovada', async () => {
    const { service } = montar({ usuarioExistente: contaDeAluno() });

    const resposta = await service.aprovar('insc-1', PROFESSOR_AUTENTICADO);

    expect(resposta.inscricaoId).toBe('insc-1');
  });
});
