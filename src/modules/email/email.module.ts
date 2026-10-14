import { Global, Module } from '@nestjs/common';

import { EmailService } from './email.service';

/**
 * Modulo FOLHA: nao depende de nenhum outro modulo do dominio.
 *
 * `@Global()` porque e infraestrutura, nao regra de negocio — na pratica
 * qualquer modulo pode querer notificar alguem, e repetir `imports:
 * [EmailModule]` em cada um deles seria ruido sem informacao. E o mesmo
 * tratamento que o ConfigModule ja recebe.
 *
 * Nenhum modulo o consome hoje: o servico existe preparado, aguardando a
 * primeira tarefa real de e-mail. Registra-lo desde ja no AppModule tem um
 * efeito concreto — a configuracao e validada no boot e o estado do e-mail
 * aparece no log, em vez de ser descoberto na primeira tentativa de envio.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
