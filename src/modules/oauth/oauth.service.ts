import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { AuthService } from '../auth/auth.service';
import { gerarSegredo, pkceConfere, sha256 } from './cripto';
import { OAuthCliente } from './entities/oauth-cliente.model';
import { OAuthCodigo } from './entities/oauth-codigo.model';
import { OAuthRefreshToken } from './entities/oauth-refresh-token.model';
import { OAuthErro } from './oauth-erro';
import { redirectUriAceitavel, redirectUriRegistrada } from './redirecionamento';

const VALIDADE_CODIGO_MS = 5 * 60 * 1000; // 5 minutos
const VALIDADE_REFRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const ESCOPO_PADRAO = 'mcp';

/** Parametros do /authorize, como chegam na query (GET) ou no formulario (POST). */
export interface PedidoDeAutorizacao {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
}

/** Pedido ja conferido: cliente existe, URI registrada, PKCE presente. */
export interface PedidoValidado {
  cliente: OAuthCliente;
  redirectUri: string;
  state?: string;
  escopo: string;
  codeChallenge: string;
}

export interface RespostaDeToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/**
 * Erro que impede devolver o usuario ao cliente (cliente desconhecido ou
 * redirect_uri invalida). A especificacao proibe redirecionar nesses casos,
 * porque a URI poderia ser de um atacante: mostra-se uma pagina de erro.
 */
export class ErroSemRedirecionamento extends Error {}

/** Erro que pode ser devolvido ao cliente via redirect_uri?error=... */
export class ErroComRedirecionamento extends Error {
  constructor(
    readonly codigo: string,
    readonly descricao: string,
    readonly redirectUri: string,
    readonly state?: string,
  ) {
    super(descricao);
  }
}

@Injectable()
export class OAuthService {
  constructor(
    @InjectModel(OAuthCliente) private readonly clienteModel: typeof OAuthCliente,
    @InjectModel(OAuthCodigo) private readonly codigoModel: typeof OAuthCodigo,
    @InjectModel(OAuthRefreshToken) private readonly refreshModel: typeof OAuthRefreshToken,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // URLs publicas
  // ---------------------------------------------------------------------------

  get urlPublica(): string {
    return this.config.getOrThrow<string>('app.urlPublica');
  }

  private get prefixo(): string {
    return this.config.getOrThrow<string>('app.prefixo');
  }

  /** O "resource" do MCP: exatamente a URL que se cadastra no Claude. */
  get urlRecursoMcp(): string {
    return `${this.urlPublica}/${this.prefixo}/mcp`;
  }

  get urlMetadataDoRecurso(): string {
    return `${this.urlPublica}/.well-known/oauth-protected-resource`;
  }

  /** RFC 9728: diz ao cliente qual servidor de autorizacao protege o MCP. */
  metadataDoRecurso() {
    return {
      resource: this.urlRecursoMcp,
      authorization_servers: [this.urlPublica],
      scopes_supported: [ESCOPO_PADRAO],
      bearer_methods_supported: ['header'],
      resource_name: 'Plataforma de Monitoria',
    };
  }

  /** RFC 8414: onde ficam os endpoints e o que este servidor suporta. */
  metadataDoServidor() {
    const base = `${this.urlPublica}/${this.prefixo}/oauth`;
    return {
      issuer: this.urlPublica,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [ESCOPO_PADRAO],
    };
  }

  // ---------------------------------------------------------------------------
  // Registro dinamico de cliente (RFC 7591)
  // ---------------------------------------------------------------------------

  async registrarCliente(corpo: Record<string, unknown>) {
    const redirectUris = corpo.redirect_uris;

    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      throw new OAuthErro('invalid_redirect_uri', 'Informe ao menos uma redirect_uri.');
    }
    if (redirectUris.length > 10 || !redirectUris.every((uri) => typeof uri === 'string' && redirectUriAceitavel(uri))) {
      throw new OAuthErro('invalid_redirect_uri', 'redirect_uri invalida: use https ou loopback (localhost).');
    }

    const metodo = corpo.token_endpoint_auth_method;
    if (metodo !== undefined && metodo !== 'none') {
      throw new OAuthErro('invalid_client_metadata', 'Apenas clientes publicos (token_endpoint_auth_method "none").');
    }

    const nome = typeof corpo.client_name === 'string' ? corpo.client_name.slice(0, 200) : null;
    const cliente = await this.clienteModel.create({ nome, redirectUris });

    return {
      client_id: cliente.id,
      client_id_issued_at: Math.floor(cliente.createdAt.getTime() / 1000),
      client_name: cliente.nome ?? undefined,
      redirect_uris: cliente.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  // ---------------------------------------------------------------------------
  // Autorizacao: valida o pedido, autentica o usuario e emite o codigo
  // ---------------------------------------------------------------------------

  async validarPedido(pedido: PedidoDeAutorizacao): Promise<PedidoValidado> {
    const cliente = pedido.client_id ? await this.buscarCliente(pedido.client_id) : null;
    if (!cliente) {
      throw new ErroSemRedirecionamento('Aplicativo cliente desconhecido.');
    }

    const redirectUri = pedido.redirect_uri;
    if (!redirectUri || !redirectUriRegistrada(redirectUri, cliente.redirectUris)) {
      throw new ErroSemRedirecionamento('Endereco de retorno nao autorizado para este aplicativo.');
    }

    // Daqui em diante, a URI e confiavel: erros voltam para o cliente.
    const erro = (descricao: string, codigo = 'invalid_request') =>
      new ErroComRedirecionamento(codigo, descricao, redirectUri, pedido.state);

    if (pedido.response_type !== 'code') {
      throw erro('response_type deve ser "code".', 'unsupported_response_type');
    }
    if (!pedido.code_challenge || pedido.code_challenge_method !== 'S256') {
      throw erro('PKCE obrigatorio: envie code_challenge com code_challenge_method=S256.');
    }
    if (pedido.resource && this.normalizar(pedido.resource) !== this.normalizar(this.urlRecursoMcp)) {
      throw erro('resource desconhecido.', 'invalid_target');
    }

    return {
      cliente,
      redirectUri,
      state: pedido.state,
      escopo: pedido.scope || ESCOPO_PADRAO,
      codeChallenge: pedido.code_challenge,
    };
  }

  /**
   * Confere email e senha com as MESMAS regras do login da API (timing
   * constante, usuario desativado) e devolve o codigo de autorizacao.
   */
  async autorizar(pedido: PedidoValidado, email: string, senha: string): Promise<string> {
    const usuario = await this.authService.validarCredenciais(email, senha);

    const codigo = gerarSegredo();
    await this.codigoModel.create({
      codigoHash: sha256(codigo),
      clienteId: pedido.cliente.id,
      usuarioId: usuario.id,
      redirectUri: pedido.redirectUri,
      codeChallenge: pedido.codeChallenge,
      escopo: pedido.escopo,
      expiraEm: new Date(Date.now() + VALIDADE_CODIGO_MS),
    });

    return codigo;
  }

  // ---------------------------------------------------------------------------
  // Endpoint de token
  // ---------------------------------------------------------------------------

  async emitirToken(corpo: Record<string, string | undefined>): Promise<RespostaDeToken> {
    switch (corpo.grant_type) {
      case 'authorization_code':
        return this.trocarCodigo(corpo);
      case 'refresh_token':
        return this.renovar(corpo);
      default:
        throw new OAuthErro('unsupported_grant_type', 'grant_type deve ser authorization_code ou refresh_token.');
    }
  }

  private async trocarCodigo(corpo: Record<string, string | undefined>): Promise<RespostaDeToken> {
    const { code, code_verifier, redirect_uri, client_id } = corpo;

    if (!code || !code_verifier || !redirect_uri || !client_id) {
      throw new OAuthErro('invalid_request', 'Informe code, code_verifier, redirect_uri e client_id.');
    }

    const registro = await this.codigoModel.findOne({ where: { codigoHash: sha256(code) } });

    // Uma unica mensagem para todos os casos: nao ajuda quem esta testando codigos.
    const invalido = () => new OAuthErro('invalid_grant', 'Codigo de autorizacao invalido ou expirado.');

    if (!registro || registro.usadoEm || registro.expiraEm.getTime() < Date.now()) throw invalido();
    if (registro.clienteId !== client_id || registro.redirectUri !== redirect_uri) throw invalido();
    if (!pkceConfere(code_verifier, registro.codeChallenge)) throw invalido();

    /**
     * Marca como usado com UPDATE condicional: se duas requisicoes chegarem
     * juntas com o mesmo codigo, so uma consegue (a outra afeta 0 linhas).
     */
    const [afetadas] = await this.codigoModel.update(
      { usadoEm: new Date() },
      { where: { id: registro.id, usadoEm: { [Op.is]: null } } },
    );
    if (afetadas !== 1) throw invalido();

    return this.emitirPar(registro.clienteId, registro.usuarioId, registro.escopo);
  }

  private async renovar(corpo: Record<string, string | undefined>): Promise<RespostaDeToken> {
    const { refresh_token, client_id } = corpo;

    if (!refresh_token || !client_id) {
      throw new OAuthErro('invalid_request', 'Informe refresh_token e client_id.');
    }

    const registro = await this.refreshModel.findOne({ where: { tokenHash: sha256(refresh_token) } });
    const invalido = () => new OAuthErro('invalid_grant', 'Refresh token invalido, expirado ou ja utilizado.');

    if (!registro || registro.clienteId !== client_id) throw invalido();

    /**
     * Deteccao de reuso: um refresh token so e usado uma vez. Se um token ja
     * rotacionado aparece de novo, alguem pode ter copiado o token. Revoga
     * todos os tokens daquele usuario naquele cliente: o dono legitimo so
     * precisa fazer login de novo, e o invasor perde o acesso.
     */
    if (registro.revogadoEm) {
      await this.refreshModel.update(
        { revogadoEm: new Date() },
        { where: { clienteId: registro.clienteId, usuarioId: registro.usuarioId, revogadoEm: { [Op.is]: null } } },
      );
      throw invalido();
    }

    if (registro.expiraEm.getTime() < Date.now()) throw invalido();

    const [afetadas] = await this.refreshModel.update(
      { revogadoEm: new Date() },
      { where: { id: registro.id, revogadoEm: { [Op.is]: null } } },
    );
    if (afetadas !== 1) throw invalido();

    return this.emitirPar(registro.clienteId, registro.usuarioId, registro.escopo);
  }

  /**
   * Access token = o MESMO JWT do login da API. Assim o JwtStrategy valida os
   * dois sem mudanca nenhuma, e usuario desativado perde o acesso na hora.
   */
  private async emitirPar(clienteId: string, usuarioId: string, escopo: string | null): Promise<RespostaDeToken> {
    let acesso: { token: string; expiraEmSegundos: number };
    try {
      acesso = await this.authService.emitirTokenDeAcesso(usuarioId);
    } catch {
      throw new OAuthErro('invalid_grant', 'Usuario inexistente ou desativado.');
    }

    const refreshToken = gerarSegredo();
    await this.refreshModel.create({
      tokenHash: sha256(refreshToken),
      clienteId,
      usuarioId,
      escopo,
      expiraEm: new Date(Date.now() + VALIDADE_REFRESH_MS),
    });

    return {
      access_token: acesso.token,
      token_type: 'Bearer',
      expires_in: acesso.expiraEmSegundos,
      refresh_token: refreshToken,
      scope: escopo ?? ESCOPO_PADRAO,
    };
  }

  private async buscarCliente(clientId: string): Promise<OAuthCliente | null> {
    // client_id e UUID: um valor fora do formato nao pode chegar ao Postgres,
    // que responderia com erro de sintaxe (500) em vez de "nao encontrado".
    const ehUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId);
    return ehUuid ? this.clienteModel.findByPk(clientId) : null;
  }

  private normalizar(url: string): string {
    return url.replace(/\/+$/, '');
  }
}
