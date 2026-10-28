import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool, ToolRoles } from '@rekog/mcp-nest';

import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { LEITURA } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { ParticipacaoService } from '../monitorias/participacao.service';
import { IndicadoresDaMonitoriaMcpDto, IndicadoresDaPlataformaMcpDto } from './analytics.mcp-dto';
import { AnalyticsService } from './analytics.service';
import {
  AtividadeMonitorDto,
  IndicadoresMonitoriaDto,
  IndicadoresPlataformaDto,
} from './dto/indicadores.dto';

/**
 * Ferramentas MCP de indicadores. Espelham `AnalyticsController`, inclusive na
 * escada de acesso: a visao da plataforma e de PROFESSOR, a da monitoria e de
 * quem participa dela, e a atividade individual dos monitores e so do professor
 * responsavel — porque e o unico recorte que nomeia o desempenho de cada aluno.
 */
@McpController('analytics')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class AnalyticsMcpController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly participacaoService: ParticipacaoService,
  ) {}

  @Tool({
    name: 'indicadores_da_plataforma',
    description:
      'Numeros agregados da plataforma: atendimentos por situacao, alunos atendidos, monitores e monitorados ativos, ' +
      'avaliacoes e pontos distribuidos. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(IndicadoresDaPlataformaMcpDto),
    annotations: LEITURA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  plataforma(
    @Payload() args: IndicadoresDaPlataformaMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<IndicadoresPlataformaDto> {
    return this.analyticsService.plataforma(usuarioMcp(ctx).id, args.apenasMinhas ?? false);
  }

  @Tool({
    name: 'indicadores_da_monitoria',
    description:
      'Numeros de uma monitoria: atendimentos, taxa de comparecimento, ausencias, avaliacoes e materiais publicados. ' +
      'Exige participar dela ou ser o professor responsavel.',
    parameters: dtoParaJsonSchema(IndicadoresDaMonitoriaMcpDto),
    annotations: LEITURA,
  })
  async monitoria(
    @Payload() args: IndicadoresDaMonitoriaMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<IndicadoresMonitoriaDto> {
    await this.participacaoService.exigirRequisito(args.monitoriaId, usuarioMcp(ctx), {});

    return this.analyticsService.monitoria(args.monitoriaId);
  }

  @Tool({
    name: 'atividade_dos_monitores',
    description:
      'Desempenho individual de cada monitor da monitoria, incluindo a carga horaria acumulada em minutos e em horas, ' +
      'somada apenas das sessoes efetivamente realizadas. Somente o professor responsavel.',
    parameters: dtoParaJsonSchema(IndicadoresDaMonitoriaMcpDto),
    annotations: LEITURA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  async monitores(
    @Payload() args: IndicadoresDaMonitoriaMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<AtividadeMonitorDto[]> {
    await this.participacaoService.exigirRequisito(args.monitoriaId, usuarioMcp(ctx), {
      professorResponsavel: 'EXIGIDO',
    });

    return this.analyticsService.monitores(args.monitoriaId);
  }
}
