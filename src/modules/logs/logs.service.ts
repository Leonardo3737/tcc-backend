import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Request } from 'express';

import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { LogRequisicao } from './entities/log-requisicao.model';
import { paraRegistro } from './redacao';

/**
 * Rotas que nao geram registro.
 *
 * O Swagger serve dezenas de arquivos estaticos por carregamento de pagina;
 * registrar cada um encheria a tabela de ruido e esconderia o que importa.
 */
const IGNORADAS = ['/docs', '/favicon.ico'];

export interface DadosDoRegistro {
  requisicao: Request;
  statusHttp: number;
  duracaoMs: number;
  resposta?: unknown;
  erro?: unknown;
}

/**
 * Gravacao da trilha de requisicoes.
 *
 * REGRA ABSOLUTA: registrar log nunca derruba, nem atrasa, uma requisicao.
 *
 * Disso decorrem duas decisoes. A primeira e que toda falha aqui e engolida com
 * um aviso — a alternativa seria o banco de log indisponivel transformar uma API
 * saudavel em erro 500. A segunda e que a escrita NAO e aguardada por quem
 * chama: o cliente nao deve esperar um INSERT que nao tem nada a ver com a
 * resposta dele.
 */
@Injectable()
export class LogsService implements OnModuleInit {
  private readonly logger = new Logger(LogsService.name);

  constructor(
    @InjectModel(LogRequisicao) private readonly logModel: typeof LogRequisicao,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.habilitados()) {
      this.logger.warn('Log de requisicoes DESABILITADO (LOGS_REQUISICAO_HABILITADOS=false).');
    }
  }

  /**
   * Agenda a gravacao e retorna imediatamente.
   *
   * `void` e deliberado: quem chama esta no caminho da resposta ao cliente e
   * nao pode esperar por isto. `registrar` nunca rejeita, entao nao ha promessa
   * solta sem tratamento.
   */
  agendar(dados: DadosDoRegistro): void {
    void this.registrar(dados);
  }

  async registrar(dados: DadosDoRegistro): Promise<void> {
    const { requisicao, statusHttp, duracaoMs } = dados;

    if (!this.habilitados() || this.ignorar(requisicao)) {
      return;
    }

    try {
      await this.logModel.create({
        usuarioId: this.usuarioDa(requisicao),
        metodo: requisicao.method,
        caminho: this.cortar(requisicao.originalUrl ?? requisicao.url, 500),
        rota: this.rotaDe(requisicao),
        statusHttp,
        duracaoMs: Math.max(0, Math.round(duracaoMs)),
        corpo: paraRegistro(requisicao.body),
        query: paraRegistro(requisicao.query),
        resposta: paraRegistro(dados.resposta),
        erro: this.mensagemDoErro(dados.erro),
        ip: this.cortar(requisicao.ip ?? null, 60),
        userAgent: this.cortar(requisicao.get('user-agent') ?? null, 300),
        criadoEm: new Date(),
      });
    } catch (erro) {
      // Nao sobe: log indisponivel nao pode virar erro 500 numa API saudavel.
      const motivo = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Falha ao gravar log de requisicao: ${motivo}`);
    }
  }

  /**
   * O usuario vem do token, nunca do corpo.
   *
   * `request.user` e populado pelo JwtAuthGuard, que roda antes do interceptor.
   * Em requisicao anonima — login, recuperacao de senha — fica nulo, e isso e
   * informacao: significa que a chamada nao estava autenticada.
   */
  private usuarioDa(requisicao: Request): string | null {
    const usuario = (requisicao as Request & { user?: UsuarioAutenticado }).user;
    return usuario?.id ?? null;
  }

  /**
   * Caminho com parametros (/api/alunos/:usuarioId), montado pelo Express.
   *
   * `route.path` so existe quando alguma rota casou. Em 404 fica nulo, o que
   * tambem e informacao util: ninguem reconheceu aquele caminho.
   */
  private rotaDe(requisicao: Request): string | null {
    const rota = (requisicao as Request & { route?: { path?: string } }).route?.path;

    if (!rota) {
      return null;
    }

    const base = (requisicao.baseUrl ?? '') + rota;
    return this.cortar(base, 300);
  }

  private mensagemDoErro(erro: unknown): string | null {
    if (!erro) {
      return null;
    }

    if (erro instanceof Error) {
      return this.cortar(`${erro.name}: ${erro.message}`, 2_000);
    }

    return paraRegistro(erro, 2_000);
  }

  private cortar(valor: string | null, limite: number): string | null {
    if (!valor) {
      return null;
    }

    return valor.length > limite ? valor.slice(0, limite) : valor;
  }

  private ignorar(requisicao: Request): boolean {
    const caminho = requisicao.originalUrl ?? requisicao.url ?? '';
    return IGNORADAS.some((prefixo) => caminho.startsWith(prefixo));
  }

  private habilitados(): boolean {
    return this.config.get<boolean>('logs.habilitados') !== false;
  }
}
