import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Publico } from '../../common/decorators/publico.decorator';
import { ConfiguracaoRespostaDto } from './dto/configuracao-resposta.dto';

/**
 * Metadados de operacao da instituicao.
 *
 * Publico de proposito: nao ha nada sensivel aqui — fuso horario e limites de
 * duracao — e a tela de login ja precisa do fuso para formatar datas antes de
 * haver token. Exigir autenticacao so adiaria o problema.
 *
 * NAO expoe nada de infraestrutura: nem banco, nem segredo, nem versao de
 * dependencia. Um endpoint de configuracao e um alvo obvio para reconhecimento,
 * entao ele devolve apenas o que o cliente precisa para montar requisicoes validas.
 */
@ApiTags('Configuracao')
@Controller('configuracao')
export class ConfiguracaoController {
  constructor(private readonly config: ConfigService) {}

  @Publico()
  @Get()
  @ApiOperation({
    summary: 'Parametros de operacao que o cliente precisa conhecer.',
    description:
      'Fuso horario da instituicao e limites de agendamento. Buscar uma vez no boot ' +
      'do frontend evita duplicar esses valores no codigo do cliente.',
  })
  @ApiOkResponse({ type: ConfiguracaoRespostaDto })
  obter(): ConfiguracaoRespostaDto {
    return {
      fusoHorario: this.config.getOrThrow<string>('agenda.fusoHorario'),
      agendamento: {
        duracaoMinimaMinutos: this.config.getOrThrow<number>('agenda.duracaoMinimaMinutos'),
        duracaoMaximaMinutos: this.config.getOrThrow<number>('agenda.duracaoMaximaMinutos'),
        antecedenciaMinimaMinutos: this.config.getOrThrow<number>(
          'agenda.antecedenciaMinimaMinutos',
        ),
        cancelamentoAntecedenciaMinutos: this.config.getOrThrow<number>(
          'agenda.cancelamentoAntecedenciaMinutos',
        ),
      },
    };
  }
}
