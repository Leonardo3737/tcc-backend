import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool } from '@rekog/mcp-nest';

import { LEITURA } from '../../common/mcp/anotacoes';
import { SEM_ARGUMENTOS, dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { FiltroRankingDto } from './dto/filtro-ranking.dto';
import { PosicaoRankingDto, ResumoPontuacaoDto } from './dto/ranking-resposta.dto';
import { RegrasDePontuacaoRespostaDto } from './dto/regras-resposta.dto';
import { GamificacaoService } from './gamificacao.service';

/**
 * Ferramentas MCP de gamificacao. Somente leitura: pontos nao sao lancados a
 * mao, sao consequencia de atendimento realizado e avaliacao recebida.
 */
@McpController('gamificacao')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class GamificacaoMcpController {
  constructor(private readonly gamificacaoService: GamificacaoService) {}

  @Tool({
    name: 'listar_regras_de_pontuacao',
    description:
      'Tabela de pontos vigente: quantos pontos cada evento concede e por que. Util para explicar uma posicao do ranking.',
    parameters: SEM_ARGUMENTOS,
    annotations: LEITURA,
  })
  regras(): RegrasDePontuacaoRespostaDto {
    return this.gamificacaoService.regras();
  }

  @Tool({
    name: 'listar_ranking',
    description:
      'Classificacao dos monitores por pontos acumulados. Pode ser restrita a uma monitoria.',
    parameters: dtoParaJsonSchema(FiltroRankingDto),
    annotations: LEITURA,
  })
  ranking(@Payload() filtro: FiltroRankingDto): Promise<PosicaoRankingDto[]> {
    return this.gamificacaoService.ranking(filtro.limite, filtro.monitoriaId);
  }

  @Tool({
    name: 'obter_meus_pontos',
    description:
      'Pontuacao acumulada do usuario autenticado, com os eventos mais recentes que a formaram.',
    parameters: dtoParaJsonSchema(FiltroRankingDto),
    annotations: LEITURA,
  })
  meusPontos(
    @Payload() filtro: FiltroRankingDto,
    @Ctx() ctx: McpContext,
  ): Promise<ResumoPontuacaoDto> {
    return this.gamificacaoService.meusPontos(usuarioMcp(ctx), filtro.monitoriaId, filtro.limite);
  }
}
