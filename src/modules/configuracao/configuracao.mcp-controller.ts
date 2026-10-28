import { UseFilters, UsePipes } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpController, Tool } from '@rekog/mcp-nest';

import { LEITURA } from '../../common/mcp/anotacoes';
import { SEM_ARGUMENTOS } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { ConfiguracaoRespostaDto } from './dto/configuracao-resposta.dto';
import { montarConfiguracao } from './montar-configuracao';

/**
 * Ferramenta MCP de configuracao.
 *
 * Vale pelo mesmo motivo que a rota REST existe: sem saber o fuso da
 * instituicao e os limites de agendamento, qualquer cliente acaba chutando
 * esses valores — e um horario montado no fuso errado e recusado so na hora de
 * agendar, com uma mensagem que nao explica o porque.
 */
@McpController('configuracao')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class ConfiguracaoMcpController {
  constructor(private readonly config: ConfigService) {}

  @Tool({
    name: 'obter_configuracao',
    description:
      'Fuso horario da instituicao e limites de agendamento: duracao minima, maxima e padrao de uma sessao, ' +
      'antecedencia minima para agendar e antecedencia minima para cancelar. Consulte antes de montar horarios.',
    parameters: SEM_ARGUMENTOS,
    annotations: LEITURA,
  })
  obter(): ConfiguracaoRespostaDto {
    return montarConfiguracao(this.config);
  }
}
