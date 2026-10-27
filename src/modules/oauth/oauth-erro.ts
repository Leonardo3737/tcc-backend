import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';

/**
 * Erro no formato da RFC 6749 (secao 5.2): { error, error_description }.
 *
 * O cliente OAuth (o Claude) decide o que fazer pelo campo `error`. Por exemplo,
 * `invalid_grant` no refresh significa "peca login de novo". Por isso estes
 * erros NAO podem passar pelo TodasExcecoesFilter, que troca o formato.
 */
export class OAuthErro extends Error {
  constructor(
    readonly codigo:
      | 'invalid_request'
      | 'invalid_client'
      | 'invalid_grant'
      | 'unauthorized_client'
      | 'unsupported_grant_type'
      | 'invalid_scope'
      | 'invalid_redirect_uri'
      | 'invalid_client_metadata',
    readonly descricao: string,
    readonly status = 400,
  ) {
    super(descricao);
  }
}

/** Aplicado com @UseFilters nos endpoints que respondem JSON OAuth. */
@Catch()
export class OAuthErroFilter implements ExceptionFilter {
  catch(excecao: unknown, host: ArgumentsHost): void {
    const resposta = host.switchToHttp().getResponse<Response>();

    if (excecao instanceof OAuthErro) {
      resposta.status(excecao.status).json({ error: excecao.codigo, error_description: excecao.descricao });
      return;
    }

    // Ex.: ThrottlerException (429). Mantem o status, mas no formato OAuth.
    if (excecao instanceof HttpException) {
      resposta.status(excecao.getStatus()).json({ error: 'invalid_request', error_description: excecao.message });
      return;
    }

    console.error(excecao);
    resposta.status(500).json({ error: 'server_error', error_description: 'Erro interno no servidor.' });
  }
}
