import { ConfigService } from '@nestjs/config';

import { ConfiguracaoRespostaDto } from './dto/configuracao-resposta.dto';

/**
 * Le os parametros de operacao da configuracao validada.
 *
 * Funcao, e nao metodo do controller, porque tem DOIS consumidores: a rota
 * REST e a ferramenta MCP. Duplicar as cinco leituras faria os dois clientes
 * discordarem sobre os limites de agendamento no dia em que um parametro novo
 * aparecesse — e discordancia sobre limite vira agendamento recusado sem
 * explicacao.
 */
export function montarConfiguracao(config: ConfigService): ConfiguracaoRespostaDto {
  return {
    fusoHorario: config.getOrThrow<string>('agenda.fusoHorario'),
    agendamento: {
      duracaoMinimaMinutos: config.getOrThrow<number>('agenda.duracaoMinimaMinutos'),
      duracaoMaximaMinutos: config.getOrThrow<number>('agenda.duracaoMaximaMinutos'),
      duracaoPadraoMinutos: config.getOrThrow<number>('agenda.duracaoPadraoMinutos'),
      antecedenciaMinimaMinutos: config.getOrThrow<number>('agenda.antecedenciaMinimaMinutos'),
      cancelamentoAntecedenciaMinutos: config.getOrThrow<number>(
        'agenda.cancelamentoAntecedenciaMinutos',
      ),
    },
  };
}
