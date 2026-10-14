import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Notificacao } from './entities/notificacao.model';
import { NotificacoesService } from './notificacoes.service';

/**
 * Modulo FOLHA: nao e importado por ninguem.
 *
 * A comunicacao com o nucleo acontece por eventos (./eventos.ts) e por consultas
 * SQL de leitura. Atendimentos e Monitorias emitem e seguem adiante; nenhum
 * deles conhece este service. Remover a linha do AppModule desliga os avisos
 * sem quebrar compilacao nem regra de negocio — os `emit` continuam ocorrendo,
 * apenas sem ouvinte.
 *
 * Registra apenas o proprio model. As demais leituras (atendimento, inscricoes,
 * participantes, usuarios) sao SQL direto, deliberadamente: sao consultas de
 * projecao, que montam exatamente os campos da mensagem. Registrar meia duzia
 * de models para reproduzir isso com `include` traria acoplamento sem leitura
 * mais clara.
 */
@Module({
  imports: [SequelizeModule.forFeature([Notificacao])],
  providers: [NotificacoesService],
  exports: [NotificacoesService],
})
export class NotificacoesModule {}
