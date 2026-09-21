import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Avaliacao } from '../avaliacoes/entities/avaliacao.model';
import { DisponibilidadesModule } from '../disponibilidades/disponibilidades.module';
import { MonitoriasModule } from '../monitorias/monitorias.module';
import { AtendimentosController } from './atendimentos.controller';
import { AtendimentosMonitoriaController } from './atendimentos-monitoria.controller';
import { AtendimentosService } from './atendimentos.service';
import { Atendimento } from './entities/atendimento.model';
import { AtendimentoParticipante } from './entities/atendimento-participante.model';
import { AtendimentoStatusHistorico } from './entities/atendimento-status-historico.model';

/**
 * Atendimento, inscricao e historico de status ficam juntos: nenhum dos tres
 * existe sem a sessao, e a inscricao precisa participar da MESMA transacao do
 * agendamento (capacidade sob lock). Separar em modulos empurraria a transacao
 * para fora da fronteira do modulo.
 *
 * Depende de MonitoriasModule (ParticipacaoService, ParticipantesService) e de
 * DisponibilidadesModule (validacao da janela do monitor). A dependencia e
 * unidirecional — nenhum dos dois conhece este modulo.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Atendimento,
      AtendimentoParticipante,
      AtendimentoStatusHistorico,
      Avaliacao,
    ]),
    MonitoriasModule,
    DisponibilidadesModule,
  ],
  controllers: [AtendimentosMonitoriaController, AtendimentosController],
  providers: [AtendimentosService],
  exports: [AtendimentosService],
})
export class AtendimentosModule {}
