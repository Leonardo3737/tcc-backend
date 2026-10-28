import { Module } from '@nestjs/common';

import { MonitoriasModule } from '../monitorias/monitorias.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsMcpController } from './analytics.mcp-controller';
import { AnalyticsService } from './analytics.service';

/**
 * Modulo somente-leitura. Nao registra models proprios: consulta as tabelas dos
 * outros modulos por SQL de agregacao, sem escrever em nenhuma delas.
 * Importa MonitoriasModule apenas pelo ParticipacaoGuard.
 *
 * Exporta o service porque a carga horaria do monitor nasceu aqui, como
 * indicador, e o relatorio de monitoria precisa do MESMO numero. Duplicar a
 * consulta faria o documento e a tela divergirem na primeira mudanca de regra —
 * e e o tipo de divergencia que ninguem percebe, porque os dois numeros estao em
 * lugares diferentes.
 */
@Module({
  imports: [MonitoriasModule],
  controllers: [AnalyticsController, AnalyticsMcpController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
