import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { AtendimentoParticipante } from '../atendimentos/entities/atendimento-participante.model';
import { MonitoriasModule } from '../monitorias/monitorias.module';
import { AvaliacoesController } from './avaliacoes.controller';
import { AvaliacoesService } from './avaliacoes.service';
import { Avaliacao } from './entities/avaliacao.model';

/**
 * Separado de AtendimentosModule apesar do 1:0..1 com a inscricao: a autorizacao
 * e outra (so o proprio inscrito) e a regra temporal e propria (so apos a
 * conclusao). Depende de MonitoriasModule para o controle de acesso por
 * participacao; nao depende de AtendimentosModule — le a inscricao direto pelo
 * model, o que evita um ciclo.
 */
@Module({
  imports: [SequelizeModule.forFeature([Avaliacao, AtendimentoParticipante]), MonitoriasModule],
  controllers: [AvaliacoesController],
  providers: [AvaliacoesService],
  exports: [AvaliacoesService],
})
export class AvaliacoesModule {}
