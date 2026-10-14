/**
 * Dispara AGORA as rotinas de notificacao, sem esperar o agendador.
 *
 * Existe por duas razoes:
 *
 *  1. TESTAR. A condicao de disparo do lembrete e "amanhecer": sem um gatilho
 *     manual, verificar qualquer mudanca exigiria esperar o relogio ou mexer no
 *     intervalo do @Cron e reiniciar a aplicacao.
 *  2. OPERAR. Se a aplicacao ficou fora do ar durante a janela em que os
 *     lembretes sairiam, este comando os recupera — o registro no banco impede
 *     que alguem receba duas vezes.
 *
 * Sobe um contexto Nest SEM servidor HTTP: nenhuma porta e ocupada, entao roda
 * junto com a aplicacao em pe.
 *
 * Uso (exige build e NOTIFICACOES_HABILITADAS=true):
 *   npm run build
 *   NOTIFICACOES_HABILITADAS=true npm run enviar-lembretes
 */
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../dist/app.module.js';
import { NotificacoesService } from '../dist/modules/notificacoes/notificacoes.service.js';

const contexto = await NestFactory.createApplicationContext(AppModule, {
  logger: ['log', 'warn', 'error'],
});

try {
  const notificacoes = contexto.get(NotificacoesService);

  console.log('\nLembretes dos atendimentos de hoje...');
  await notificacoes.lembrarAtendimentosDeHoje();

  console.log('Reenvio das notificacoes pendentes...');
  await notificacoes.reenviarPendentes();

  console.log('Concluido.\n');
} finally {
  await contexto.close();
}
