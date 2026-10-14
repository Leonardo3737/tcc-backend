import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import { LogsService } from './logs.service';

/**
 * Registra as requisicoes que CHEGARAM a ser atendidas.
 *
 * DIVISAO DE TRABALHO COM O FILTRO DE EXCECOES — e a parte que nao e obvia:
 *
 * No Nest, um guard que rejeita impede o interceptor de rodar. Um interceptor
 * sozinho, portanto, nunca veria 401 nem 403 — justamente as requisicoes que
 * mais interessam a uma trilha de acesso. E o filtro global
 * (TodasExcecoesFilter) que as enxerga, porque ele pega tudo.
 *
 * Por isso:
 *   - SUCESSO           -> registrado aqui;
 *   - QUALQUER ERRO     -> registrado pelo filtro.
 *
 * Nao ha `catchError` aqui de proposito. Registrar os dois lados duplicaria
 * toda falha de handler, que passa pelo interceptor E pelo filtro.
 */
@Injectable()
export class LogRequisicaoInterceptor implements NestInterceptor {
  constructor(private readonly logsService: LogsService) {}

  intercept(contexto: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    const http = contexto.switchToHttp();
    const requisicao = http.getRequest<Request>();
    const inicio = Date.now();

    return proximo.handle().pipe(
      tap((resposta) => {
        this.logsService.agendar({
          requisicao,
          statusHttp: http.getResponse<Response>().statusCode,
          duracaoMs: Date.now() - inicio,
          resposta,
        });
      }),
    );
  }
}
