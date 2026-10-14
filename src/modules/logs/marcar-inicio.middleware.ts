import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Marca o instante em que a requisicao entrou.
 *
 * Existe porque o filtro de excecoes precisa da duracao e nao tem como medi-la:
 * quando um guard rejeita, o interceptor — que e quem cronometra o caminho
 * feliz — nunca chega a rodar. Middleware roda antes dos guards, entao e o
 * unico ponto que enxerga o inicio de TODA requisicao.
 */
@Injectable()
export class MarcarInicioMiddleware implements NestMiddleware {
  use(requisicao: Request, _resposta: Response, proximo: NextFunction): void {
    (requisicao as Request & { inicioEmMs?: number }).inicioEmMs = Date.now();
    proximo();
  }
}
