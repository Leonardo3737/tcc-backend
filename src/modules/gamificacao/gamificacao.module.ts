import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { MonitoriaParticipante } from '../monitorias/entities/monitoria-participante.model';
import { PontuacaoEvento } from './entities/pontuacao-evento.model';
import { GamificacaoController } from './gamificacao.controller';
import { GamificacaoService } from './gamificacao.service';

/**
 * Modulo FOLHA: nao e importado por Atendimentos nem por Avaliacoes.
 *
 * A comunicacao acontece por eventos (src/modules/gamificacao/eventos.ts), entao
 * a dependencia e de mao unica — gamificacao conhece o nucleo, o nucleo nao
 * conhece a gamificacao. Remover este modulo do AppModule desliga a
 * funcionalidade inteira sem quebrar compilacao nem regra de negocio.
 *
 * Registra MonitoriaParticipante apenas para leitura (resolver vinculo -> aluno).
 */
@Module({
  imports: [SequelizeModule.forFeature([PontuacaoEvento, MonitoriaParticipante])],
  controllers: [GamificacaoController],
  providers: [GamificacaoService],
  exports: [GamificacaoService],
})
export class GamificacaoModule {}
