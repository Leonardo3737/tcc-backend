import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';
import { MonitoriasModule } from '../monitorias/monitorias.module';
import { RelatorioMonitoriaService } from './relatorio-monitoria.service';
import { RelatoriosController } from './relatorios.controller';
import { RelatoriosMcpController } from './relatorios.mcp-controller';

/**
 * Geracao do relatorio final de monitoria em .docx.
 *
 * Modulo FOLHA e somente-leitura: nao registra model proprio, nao escreve em
 * tabela nenhuma e ninguem o consome. Um relatorio e uma VISAO dos dados, e
 * tratar a geracao como um modulo separado mantem a manipulacao de .docx — zip,
 * XML, ancoras de modelo — fora dos modulos de dominio, que nao tem nada a ver
 * com isso.
 *
 * DEPENDENCIAS, as duas por reuso e nao por conveniencia:
 *
 *  - `MonitoriasModule` traz o `ParticipacaoGuard` e o `ParticipacaoService`, que
 *    sao a autorizacao contextual da rota ("voce e MONITOR nesta monitoria?").
 *    Reimplementar isso aqui seria duplicar a regra mais reutilizada do sistema;
 *  - `AnalyticsModule` traz a carga horaria acumulada, que nasceu como
 *    indicador. O documento e a tela precisam do MESMO numero — ver a nota em
 *    `AnalyticsModule`.
 */
@Module({
  imports: [MonitoriasModule, AnalyticsModule],
  controllers: [RelatoriosController, RelatoriosMcpController],
  providers: [RelatorioMonitoriaService],
})
export class RelatoriosModule {}
