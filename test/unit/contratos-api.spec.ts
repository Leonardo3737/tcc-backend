import { Op } from 'sequelize';

import { PerfilUsuario } from '../../src/common/enums/perfil-usuario.enum';
import { StatusMonitoria } from '../../src/common/enums/status-monitoria.enum';
import { TipoPontuacao } from '../../src/common/enums/tipo-pontuacao.enum';
import { UsuarioAutenticado } from '../../src/common/types/usuario-autenticado';
import { AtendimentosService } from '../../src/modules/atendimentos/atendimentos.service';
import {
  CampoOrdenacaoAtendimento,
  DirecaoOrdenacao,
  FiltroAtendimentosDto,
} from '../../src/modules/atendimentos/dto/filtro-atendimentos.dto';
import { AuthService } from '../../src/modules/auth/auth.service';
import { GamificacaoService } from '../../src/modules/gamificacao/gamificacao.service';
import { STATUS_EM_ANDAMENTO } from '../../src/modules/monitorias/dto/filtro-minhas-monitorias.dto';
import { MonitoriasService } from '../../src/modules/monitorias/monitorias.service';

const usuario: UsuarioAutenticado = {
  id: 'u-1',
  nome: 'Ana',
  email: 'ana@ufx.edu.br',
  perfis: [PerfilUsuario.ALUNO],
};

describe('A1 — extrato de pontos agrega no banco, nao em memoria', () => {
  function montar(gruposPorTipo: { tipo: string; total: string }[]) {
    const query = jest.fn().mockResolvedValue(gruposPorTipo);
    const findAll = jest.fn().mockResolvedValue([]);

    const pontuacaoModel = { findAll, sequelize: { query } };

    return {
      service: new GamificacaoService(pontuacaoModel as never, {} as never),
      query,
      findAll,
    };
  }

  /**
   * Regressao da inconsistencia que motivou a correcao: o extrato somava as 100
   * linhas mais recentes enquanto o /ranking somava tudo via SQL. Quem tivesse
   * mais de 100 eventos via dois totais diferentes para si mesmo.
   */
  it('soma TODOS os eventos, independentemente do limite da lista', async () => {
    const { service } = montar([
      { tipo: TipoPontuacao.ATENDIMENTO_REALIZADO, total: '1200' },
      { tipo: TipoPontuacao.AVALIACAO_RECEBIDA, total: '340' },
    ]);

    const resumo = await service.meusPontos(usuario, undefined, 5);

    expect(resumo.total).toBe(1540);
    expect(resumo.porTipo).toEqual({
      [TipoPontuacao.ATENDIMENTO_REALIZADO]: 1200,
      [TipoPontuacao.AVALIACAO_RECEBIDA]: 340,
    });
  });

  it('agrega por SQL, com o filtro opcional de monitoria', async () => {
    const { service, query } = montar([]);

    await service.meusPontos(usuario, 'm-1');

    const [sql, opcoes] = query.mock.calls[0];
    expect(sql).toMatch(/GROUP BY tipo/);
    expect(opcoes.replacements).toEqual({ usuarioId: 'u-1', monitoriaId: 'm-1' });
  });

  it('devolve total zero quando nao ha eventos', async () => {
    const { service } = montar([]);

    await expect(service.meusPontos(usuario)).resolves.toMatchObject({ total: 0, porTipo: {} });
  });

  // A2: o parametro deixou de ser aceito e ignorado.
  it('aplica o limite apenas a lista de ultimos eventos', async () => {
    const { service, findAll } = montar([{ tipo: TipoPontuacao.AVALIACAO_RECEBIDA, total: '10' }]);

    await service.meusPontos(usuario, undefined, 7);

    expect(findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 7 }));
  });
});

describe('A4 — expiracao utilizavel pelo cliente', () => {
  const EXP = Math.floor(Date.now() / 1000) + 3600;

  function montar() {
    const jwtService = {
      signAsync: jest.fn().mockResolvedValue('token.assinado.aqui'),
      decode: jest.fn().mockReturnValue({ exp: EXP }),
    };

    const usuariosService = {
      buscarPorEmailComSenha: jest.fn().mockResolvedValue({
        id: 'u-1',
        nome: 'Ana',
        email: 'ana@ufx.edu.br',
        ativo: true,
        senhaHash: 'hash',
        createdAt: new Date(),
        aluno: { matricula: '2021', curso: null },
        professor: null,
      }),
    };

    const hashService = { conferir: jest.fn().mockResolvedValue(true) };
    const config = { getOrThrow: jest.fn().mockReturnValue('1h') };

    return {
      service: new AuthService(
        usuariosService as never,
        hashService as never,
        jwtService as never,
        config as never,
      ),
      jwtService,
    };
  }

  /**
   * O valor vem do claim `exp` do token EFETIVAMENTE assinado, e nao de uma
   * releitura de JWT_EXPIRES_IN — duas fontes que podem divergir.
   */
  it('deriva expiraEmSegundos e expiraEmIso do claim exp', async () => {
    const { service, jwtService } = montar();

    const resposta = await service.login({ email: 'ana@ufx.edu.br', senha: 'senhaSegura123' });

    expect(jwtService.decode).toHaveBeenCalledWith('token.assinado.aqui');
    expect(resposta.expiraEmSegundos).toBeGreaterThan(3590);
    expect(resposta.expiraEmSegundos).toBeLessThanOrEqual(3600);
    expect(resposta.expiraEmIso).toBe(new Date(EXP * 1000).toISOString());
  });

  it('mantem expiraEm para nao quebrar quem ja consome o campo', async () => {
    const { service } = montar();

    const resposta = await service.login({ email: 'ana@ufx.edu.br', senha: 'senhaSegura123' });

    expect(resposta.expiraEm).toBe('1h');
  });
});

describe('A6 — /monitorias/minhas paginado e filtrado', () => {
  function montar() {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });

    const monitoriaModel = { findAndCountAll };
    const participanteModel = { findAll: jest.fn().mockResolvedValue([]) };

    return {
      service: new MonitoriasService(
        monitoriaModel as never,
        participanteModel as never,
        {} as never,
        {} as never,
        {} as never,
      ),
      findAndCountAll,
    };
  }

  it('traz apenas monitorias em andamento por padrao (visao de dashboard)', async () => {
    const { service, findAndCountAll } = montar();

    await service.minhas(usuario, { pagina: 1, limite: 20, offset: 0 } as never);

    // `Op.in` e um Symbol: Object.values nao o enxerga.
    const { where } = findAndCountAll.mock.calls[0][0];
    expect(where.status[Op.in]).toEqual(STATUS_EM_ANDAMENTO);
  });

  it('permite consultar o historico informando os status terminais', async () => {
    const { service, findAndCountAll } = montar();

    await service.minhas(usuario, {
      pagina: 1,
      limite: 20,
      offset: 0,
      status: [StatusMonitoria.ENCERRADA, StatusMonitoria.CANCELADA],
    } as never);

    const { where } = findAndCountAll.mock.calls[0][0];
    expect(where.status[Op.in]).toEqual([StatusMonitoria.ENCERRADA, StatusMonitoria.CANCELADA]);
  });

  it('repassa paginacao ao banco em vez de trazer tudo', async () => {
    const { service, findAndCountAll } = montar();

    await service.minhas(usuario, { pagina: 3, limite: 10, offset: 20 } as never);

    expect(findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 }),
    );
  });
});

describe('A7 — ordenacao por whitelist', () => {
  function montar() {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });

    return {
      service: new AtendimentosService(
        { findAndCountAll } as never,
        {} as never,
        {} as never,
        {} as never, // avaliacaoModel: so e tocado quando ha usuario no contexto
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        // ConfigService: retornar undefined faz os defaults de D-15 valerem.
        { get: () => undefined } as never,
      ),
      findAndCountAll,
    };
  }

  function filtro(sobrescreve: Partial<FiltroAtendimentosDto> = {}): FiltroAtendimentosDto {
    return {
      pagina: 1,
      limite: 20,
      offset: 0,
      ordenarPor: CampoOrdenacaoAtendimento.INICIO,
      direcao: DirecaoOrdenacao.DESC,
      ...sobrescreve,
    } as FiltroAtendimentosDto;
  }

  it('ordena por inicio DESC por padrao', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarPorMonitoria('m-1', filtro());

    expect(findAndCountAll.mock.calls[0][0].order).toEqual([['inicio', 'DESC']]);
  });

  it('permite a agenda "proximos primeiro" com direcao asc', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarPorMonitoria('m-1', filtro({ direcao: DirecaoOrdenacao.ASC }));

    expect(findAndCountAll.mock.calls[0][0].order).toEqual([['inicio', 'ASC']]);
  });

  /**
   * O campo publico nunca vira nome de coluna direto: passa por um mapa. Mesmo
   * que algo escapasse do ValidationPipe, nao ha caminho do texto do cliente
   * ate o ORDER BY.
   */
  it('traduz o campo publico para a coluna real', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarPorMonitoria(
      'm-1',
      filtro({ ordenarPor: CampoOrdenacaoAtendimento.CRIADO_EM }),
    );

    expect(findAndCountAll.mock.calls[0][0].order).toEqual([['created_at', 'DESC']]);
  });

  it('cai no default quando o campo nao esta no mapa', async () => {
    const { service, findAndCountAll } = montar();

    await service.listarPorMonitoria('m-1', filtro({ ordenarPor: 'coluna; DROP TABLE' as never }));

    expect(findAndCountAll.mock.calls[0][0].order).toEqual([['inicio', 'DESC']]);
  });
});
