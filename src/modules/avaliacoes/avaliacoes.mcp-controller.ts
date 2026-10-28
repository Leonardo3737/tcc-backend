import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool } from '@rekog/mcp-nest';

import { ESCRITA, LEITURA } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { AvaliacoesService } from './avaliacoes.service';
import {
  AvaliacoesDoAtendimentoMcpDto,
  AvaliacoesDoMonitorMcpDto,
  AvaliarAtendimentoMcpDto,
} from './avaliacoes.mcp-dto';
import { AvaliacaoRespostaDto, ResumoAvaliacoesDto } from './dto/avaliacao-resposta.dto';

/**
 * Ferramentas MCP de avaliacao.
 *
 * Espelham `AvaliacoesController`, que tambem nao usa guard de participacao: a
 * autorizacao aqui depende da INSCRICAO do aluno naquele atendimento (RN05) e
 * de a sessao ja ter sido realizada com presenca confirmada (RN06) — duas
 * perguntas que so o `AvaliacoesService` consegue responder.
 */
@McpController('avaliacoes')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class AvaliacoesMcpController {
  constructor(private readonly avaliacoesService: AvaliacoesService) {}

  @Tool({
    name: 'avaliar_atendimento',
    description:
      'Registra a avaliacao de uma sessao. So o monitorado que participou dela pode avaliar (RN05), ' +
      'e apenas depois de a sessao ter sido marcada como realizada com a presenca dele confirmada (RN06). ' +
      'Uma avaliacao por participacao.',
    parameters: dtoParaJsonSchema(AvaliarAtendimentoMcpDto),
    annotations: ESCRITA,
  })
  avaliar(
    @Payload() args: AvaliarAtendimentoMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<AvaliacaoRespostaDto> {
    return this.avaliacoesService.avaliar(args.atendimentoId, args, usuarioMcp(ctx));
  }

  @Tool({
    name: 'listar_avaliacoes_do_atendimento',
    description:
      'Avaliacoes recebidas por uma sessao, com a media. Exige participar da monitoria dela.',
    parameters: dtoParaJsonSchema(AvaliacoesDoAtendimentoMcpDto),
    annotations: LEITURA,
  })
  listarDoAtendimento(
    @Payload() args: AvaliacoesDoAtendimentoMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<ResumoAvaliacoesDto> {
    return this.avaliacoesService.listarPorAtendimento(args.atendimentoId, usuarioMcp(ctx));
  }

  @Tool({
    name: 'listar_avaliacoes_do_monitor',
    description:
      'Avaliacoes acumuladas por um monitor dentro de uma monitoria, com a media. Exige participar da monitoria.',
    parameters: dtoParaJsonSchema(AvaliacoesDoMonitorMcpDto),
    annotations: LEITURA,
  })
  listarDoMonitor(
    @Payload() args: AvaliacoesDoMonitorMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<ResumoAvaliacoesDto> {
    return this.avaliacoesService.listarPorMonitor(
      args.monitoriaId,
      args.participanteId,
      usuarioMcp(ctx),
    );
  }
}
