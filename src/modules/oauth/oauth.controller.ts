import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseFilters,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';

import { Publico } from '../../common/decorators/publico.decorator';
import { OAuthErroFilter } from './oauth-erro';
import {
  ErroComRedirecionamento,
  ErroSemRedirecionamento,
  OAuthService,
  PedidoDeAutorizacao,
} from './oauth.service';
import { paginaDeErro, paginaDeLogin } from './pagina-autorizacao';
import { montarRedirecionamento } from './redirecionamento';

/**
 * Servidor de autorizacao OAuth 2.1 usado pelo conector MCP do Claude.
 *
 * Todas as rotas sao @Publico(): quem chega aqui ainda NAO tem token, esta
 * justamente vindo buscar um. Os corpos sao lidos como Record (e nao DTO)
 * de proposito: o ValidationPipe global rejeitaria campos extras que clientes
 * OAuth enviam legitimamente, e os erros precisam sair no formato da RFC.
 */
@Publico()
@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  /** RFC 7591: o Claude se registra sozinho e recebe um client_id. */
  @Throttle({ padrao: { ttl: 60_000, limit: 10 } })
  @Post('register')
  @HttpCode(201)
  @UseFilters(OAuthErroFilter)
  registrar(@Body() corpo: Record<string, unknown>) {
    return this.oauthService.registrarCliente(corpo ?? {});
  }

  /** Abre a tela de login. Os parametros vem na query string. */
  @Get('authorize')
  async telaDeLogin(@Query() pedido: PedidoDeAutorizacao, @Res() res: Response) {
    try {
      const validado = await this.oauthService.validarPedido(pedido);
      return this.html(res, 200, paginaDeLogin(pedido, validado.cliente.nome));
    } catch (erro) {
      return this.tratarErroDeAutorizacao(erro, res);
    }
  }

  /**
   * Recebe o formulario. Mesmo teto do login da API: e aqui que alguem
   * tentaria adivinhar senhas.
   */
  @Throttle({ padrao: { ttl: 60_000, limit: 5 } })
  @Post('authorize')
  async autorizar(
    @Body() corpo: PedidoDeAutorizacao & { email?: string; senha?: string; acao?: string },
    @Res() res: Response,
  ) {
    try {
      // Revalida TUDO: os campos ocultos do formulario podem ter sido alterados.
      const validado = await this.oauthService.validarPedido(corpo);

      if (corpo.acao !== 'autorizar') {
        return res.redirect(
          302,
          montarRedirecionamento(validado.redirectUri, {
            error: 'access_denied',
            error_description: 'O usuario cancelou a autorizacao.',
            state: validado.state,
          }),
        );
      }

      try {
        const codigo = await this.oauthService.autorizar(validado, corpo.email ?? '', corpo.senha ?? '');
        return res.redirect(
          302,
          montarRedirecionamento(validado.redirectUri, {
            code: codigo,
            state: validado.state,
            iss: this.oauthService.urlPublica,
          }),
        );
      } catch (erro) {
        // Senha errada ou usuario desativado: mostra a tela de novo, com a mensagem.
        if (erro instanceof UnauthorizedException || erro instanceof ForbiddenException) {
          const pedido = { ...corpo, email: undefined, senha: undefined, acao: undefined };
          return this.html(res, 401, paginaDeLogin(pedido, validado.cliente.nome, erro.message, corpo.email));
        }
        throw erro;
      }
    } catch (erro) {
      return this.tratarErroDeAutorizacao(erro, res);
    }
  }

  /**
   * Troca o codigo (ou o refresh token) por tokens. O corpo chega como
   * application/x-www-form-urlencoded, que o Nest ja interpreta por padrao.
   */
  @Post('token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @UseFilters(OAuthErroFilter)
  token(@Body() corpo: Record<string, string | undefined>) {
    return this.oauthService.emitirToken(corpo ?? {});
  }

  private tratarErroDeAutorizacao(erro: unknown, res: Response) {
    if (erro instanceof ErroSemRedirecionamento) {
      return this.html(res, 400, paginaDeErro(erro.message));
    }
    if (erro instanceof ErroComRedirecionamento) {
      return res.redirect(
        302,
        montarRedirecionamento(erro.redirectUri, {
          error: erro.codigo,
          error_description: erro.descricao,
          state: erro.state,
        }),
      );
    }
    throw erro;
  }

  private html(res: Response, status: number, conteudo: string) {
    return res
      .status(status)
      .setHeader('Cache-Control', 'no-store')
      .type('html')
      .send(conteudo);
  }
}
