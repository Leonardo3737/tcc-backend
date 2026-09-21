import { Module } from '@nestjs/common';

import { MonitoriasModule } from '../monitorias/monitorias.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Modulo somente-leitura. Nao registra models proprios: consulta as tabelas dos
 * outros modulos por SQL de agregacao, sem escrever em nenhuma delas.
 * Importa MonitoriasModule apenas pelo ParticipacaoGuard.
 */
@Module({
  imports: [MonitoriasModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
