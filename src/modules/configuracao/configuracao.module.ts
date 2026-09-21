import { Module } from '@nestjs/common';

import { ConfiguracaoController } from './configuracao.controller';

/** Modulo folha, somente leitura de configuracao. Sem service e sem model. */
@Module({ controllers: [ConfiguracaoController] })
export class ConfiguracaoModule {}
