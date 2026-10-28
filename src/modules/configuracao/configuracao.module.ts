import { Module } from '@nestjs/common';

import { ConfiguracaoController } from './configuracao.controller';
import { ConfiguracaoMcpController } from './configuracao.mcp-controller';

/** Modulo folha, somente leitura de configuracao. Sem service e sem model. */
@Module({ controllers: [ConfiguracaoController, ConfiguracaoMcpController] })
export class ConfiguracaoModule {}
