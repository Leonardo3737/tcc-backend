import { ArgumentsHost, Catch, HttpException, Logger, RpcExceptionFilter } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import { mensagemDeConstraint } from 'src/common/filters/todas-excecoes.filter';


/**
 * Equivalente ao TodasExcecoesFilter para as ferramentas MCP. Preserva a
 * mensagem das HttpException (Forbidden, NotFound...) e das constraints do
 * banco, e esconde o detalhe de erros inesperados.
 */
@Catch()
export class McpExcecoesFilter implements RpcExceptionFilter {
  private readonly logger = new Logger(McpExcecoesFilter.name);

  catch(excecao: unknown, _host: ArgumentsHost): Observable<never> {
    if (excecao instanceof RpcException) {
      return throwError(() => excecao.getError());
    }

    if (excecao instanceof HttpException) {
      const resposta = excecao.getResponse() as string | { message?: string | string[] };
      const mensagem =
        typeof resposta === 'string'
          ? resposta
          : Array.isArray(resposta.message)
            ? resposta.message.join('; ')
            : (resposta.message ?? excecao.message);
      return throwError(() => mensagem);
    }

    // Reaproveita as mensagens amigáveis das constraints (RN03, RN09...).
    const mensagemBanco = mensagemDeConstraint(excecao);
    if (mensagemBanco) {
      return throwError(() => mensagemBanco);
    }

    this.logger.error(excecao instanceof Error ? excecao.stack : String(excecao));
    return throwError(() => 'Erro interno no servidor.');
  }
}