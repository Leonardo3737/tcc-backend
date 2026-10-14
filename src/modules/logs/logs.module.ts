import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SequelizeModule } from '@nestjs/sequelize';

import { LogRequisicaoInterceptor } from './log-requisicao.interceptor';
import { MarcarInicioMiddleware } from './marcar-inicio.middleware';
import { LogRequisicao } from './entities/log-requisicao.model';
import { LogsService } from './logs.service';

/**
 * `@Global()` porque e infraestrutura, nao dominio — mesmo tratamento do
 * EmailModule. O filtro global de excecoes injeta o LogsService, e ele e
 * registrado no AppModule, fora do alcance de um import comum.
 *
 * O interceptor e registrado aqui, e nao no AppModule, para que modulo e
 * ativacao vivam juntos: remover a linha do AppModule desliga o registro de
 * requisicoes por inteiro.
 */
@Global()
@Module({
  imports: [SequelizeModule.forFeature([LogRequisicao])],
  providers: [LogsService, { provide: APP_INTERCEPTOR, useClass: LogRequisicaoInterceptor }],
  exports: [LogsService],
})
export class LogsModule implements NestModule {
  /**
   * Middleware em TODAS as rotas, so para marcar o instante de entrada.
   *
   * Precisa ser middleware, e nao interceptor: quando um guard rejeita, o
   * interceptor nao roda, e o filtro de excecoes ficaria sem como calcular a
   * duracao da requisicao que acabou de recusar.
   */
  configure(consumidor: MiddlewareConsumer): void {
    consumidor.apply(MarcarInicioMiddleware).forRoutes('*');
  }
}
