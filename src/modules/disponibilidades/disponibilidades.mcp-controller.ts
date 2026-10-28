import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool } from '@rekog/mcp-nest';

import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { ESCRITA, LEITURA, TRANSICAO } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { ParticipacaoService } from '../monitorias/participacao.service';
import { DisponibilidadesService } from './disponibilidades.service';
import {
  CriarDisponibilidadeMcpDto,
  DesativarDisponibilidadeMcpDto,
  ListarDisponibilidadesMcpDto,
} from './disponibilidades.mcp-dto';
import { DisponibilidadeRespostaDto } from './dto/disponibilidade-resposta.dto';

/**
 * Ferramentas MCP de disponibilidade do monitor.
 *
 * O requisito de escrita e o mesmo do REST, incluindo o `professorResponsavel:
 * 'NEGADO'`: o professor administra a monitoria, mas nao TEM agenda de monitor,
 * entao declarar faixa no lugar do aluno nao faz sentido no dominio.
 */
@McpController('disponibilidades')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class DisponibilidadesMcpController {
  constructor(
    private readonly disponibilidadesService: DisponibilidadesService,
    private readonly participacaoService: ParticipacaoService,
  ) {}

  @Tool({
    name: 'criar_disponibilidade',
    description:
      'Declara uma faixa semanal de disponibilidade do monitor. Somente o MONITOR da monitoria; o professor responsavel nao pode, porque nao tem agenda de monitor.',
    parameters: dtoParaJsonSchema(CriarDisponibilidadeMcpDto),
    annotations: ESCRITA,
  })
  async criar(
    @Payload() args: CriarDisponibilidadeMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<DisponibilidadeRespostaDto> {
    const contexto = await this.participacaoService.exigirRequisito(
      args.monitoriaId,
      usuarioMcp(ctx),
      { papeis: [PapelMonitoria.MONITOR], professorResponsavel: 'NEGADO' },
    );

    return this.disponibilidadesService.criar(contexto.monitoria, contexto.participacao!, args);
  }

  /**
   * Sem requisito de participacao, como no REST: quem pretende se inscrever
   * precisa ver a agenda ANTES de ter vinculo.
   */
  @Tool({
    name: 'listar_disponibilidades',
    description:
      'Lista as faixas de disponibilidade dos monitores de uma monitoria. Por padrao devolve apenas as ativas.',
    parameters: dtoParaJsonSchema(ListarDisponibilidadesMcpDto),
    annotations: LEITURA,
  })
  listar(@Payload() args: ListarDisponibilidadesMcpDto): Promise<DisponibilidadeRespostaDto[]> {
    return this.disponibilidadesService.listar(args.monitoriaId, args);
  }

  @Tool({
    name: 'desativar_disponibilidade',
    description:
      'Desativa uma faixa de disponibilidade. A faixa nao e apagada: os atendimentos ja agendados nela continuam validos. Somente o MONITOR dono dela.',
    parameters: dtoParaJsonSchema(DesativarDisponibilidadeMcpDto),
    annotations: TRANSICAO,
  })
  async desativar(
    @Payload() args: DesativarDisponibilidadeMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<DisponibilidadeRespostaDto> {
    const contexto = await this.participacaoService.exigirRequisito(
      args.monitoriaId,
      usuarioMcp(ctx),
      { papeis: [PapelMonitoria.MONITOR], professorResponsavel: 'NEGADO' },
    );

    return this.disponibilidadesService.desativar(
      args.monitoriaId,
      args.disponibilidadeId,
      contexto.participacao!,
    );
  }
}
