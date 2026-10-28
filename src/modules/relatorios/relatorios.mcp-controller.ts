import { UseFilters, UsePipes } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool } from '@rekog/mcp-nest';

import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { LEITURA } from '../../common/mcp/anotacoes';
import { ArquivoGeradoMcpDto } from '../../common/mcp/arquivo-gerado.dto';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { MonitoriaMcpDto } from '../monitorias/monitorias.mcp-dto';
import { ParticipacaoService } from '../monitorias/participacao.service';
import { RelatorioMonitoriaService } from './relatorio-monitoria.service';

const TIPO_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Ferramenta MCP do relatorio final de monitoria.
 *
 * O requisito e o mesmo do REST, com o professor responsavel NEGADO: o
 * relatorio e o documento que o MONITOR entrega a instituicao, com as
 * atividades dele e a carga horaria dele. Nao e um relatorio da monitoria.
 */
@McpController('relatorios')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class RelatoriosMcpController {
  constructor(
    private readonly relatorioService: RelatorioMonitoriaService,
    private readonly participacaoService: ParticipacaoService,
    private readonly config: ConfigService,
  ) {}

  @Tool({
    name: 'gerar_relatorio_de_monitoria',
    description:
      'Gera o relatorio final de monitoria em .docx, preenchido sobre o modelo oficial da instituicao, ' +
      'com a tabela de atividades realizadas e a carga horaria acumulada. Devolve os dados do arquivo gerado e ' +
      'o caminho para baixa-lo — o documento em si nao trafega pela ferramenta, por ser binario. ' +
      'Somente o MONITOR com vinculo ativo na monitoria.',
    parameters: dtoParaJsonSchema(MonitoriaMcpDto),
    annotations: LEITURA,
  })
  async gerar(
    @Payload() args: MonitoriaMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<ArquivoGeradoMcpDto> {
    const contexto = await this.participacaoService.exigirRequisito(
      args.monitoriaId,
      usuarioMcp(ctx),
      { papeis: [PapelMonitoria.MONITOR], professorResponsavel: 'NEGADO' },
    );

    const { conteudo, nomeDoArquivo } = await this.relatorioService.gerar(contexto);
    const prefixo = this.config.getOrThrow<string>('app.prefixo');

    return {
      nomeDoArquivo,
      tipoDeConteudo: TIPO_DOCX,
      tamanhoBytes: conteudo.length,
      caminhoDeDownload: `/${prefixo}/monitorias/${args.monitoriaId}/relatorio`,
    };
  }
}
