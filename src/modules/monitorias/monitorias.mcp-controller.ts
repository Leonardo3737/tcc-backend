import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool, ToolRoles } from '@rekog/mcp-nest';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { ESCRITA, LEITURA, TRANSICAO } from '../../common/mcp/anotacoes';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { CriarMonitoriaDto } from './dto/criar-monitoria.dto';
import { FiltroMinhasMonitoriasDto } from './dto/filtro-minhas-monitorias.dto';
import { FiltroMonitoriasDto } from './dto/filtro-monitorias.dto';
import { MonitoriaRespostaDto } from './dto/monitoria-resposta.dto';
import {
  AtualizarMonitoriaMcpDto,
  CancelarMonitoriaMcpDto,
  MonitoriaMcpDto,
} from './monitorias.mcp-dto';
import { MonitoriasService } from './monitorias.service';

/**
 * Ferramentas MCP de monitoria.
 *
 * Espelham `MonitoriasController` uma a uma. A autorizacao nao e reescrita: os
 * perfis saem do mesmo enum e as verificacoes de "professor responsavel" ficam
 * onde sempre estiveram, dentro do `MonitoriasService`, que recebe o usuario
 * autenticado exatamente como recebe no REST.
 */
@McpController('monitorias')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class MonitoriasMcpController {
  constructor(private readonly monitoriasService: MonitoriasService) {}

  @Tool({
    name: 'listar_monitorias',
    description: 'Lista monitorias com filtros por disciplina, professor, periodo e status.',
    parameters: dtoParaJsonSchema(FiltroMonitoriasDto),
    annotations: LEITURA,
  })
  listar(@Payload() filtro: FiltroMonitoriasDto): Promise<RespostaPaginada<MonitoriaRespostaDto>> {
    return this.monitoriasService.listar(filtro);
  }

  /**
   * `professorId` nao esta no schema da ferramenta: o DTO o declara sem
   * decorator de validacao justamente para que o `whitelist` do pipe o recuse
   * se vier de fora. Quem preenche e esta linha, com o id do token.
   */
  @Tool({
    name: 'criar_monitoria',
    description:
      'Cria uma monitoria. O professor responsavel e sempre o usuario autenticado. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(CriarMonitoriaDto),
    annotations: ESCRITA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  criar(@Payload() dto: CriarMonitoriaDto, @Ctx() ctx: McpContext): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.criar({ ...dto, professorId: usuarioMcp(ctx).id });
  }

  @Tool({
    name: 'listar_minhas_monitorias',
    description:
      'Lista as monitorias em que o usuario autenticado participa, com o papel dele em cada uma.',
    parameters: dtoParaJsonSchema(FiltroMinhasMonitoriasDto),
    annotations: LEITURA,
  })
  minhas(
    @Payload() filtro: FiltroMinhasMonitoriasDto,
    @Ctx() ctx: McpContext,
  ): Promise<RespostaPaginada<MonitoriaRespostaDto>> {
    return this.monitoriasService.minhas(usuarioMcp(ctx), filtro);
  }

  @Tool({
    name: 'detalhar_monitoria',
    description:
      'Detalha uma monitoria pelo id: disciplina, professor responsavel, periodo letivo e situacao.',
    parameters: dtoParaJsonSchema(MonitoriaMcpDto),
    annotations: LEITURA,
  })
  detalhar(
    @Payload() { monitoriaId }: MonitoriaMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.detalhar(monitoriaId, usuarioMcp(ctx));
  }

  @Tool({
    name: 'atualizar_monitoria',
    description: 'Altera os dados de uma monitoria. Somente o professor responsavel por ela.',
    parameters: dtoParaJsonSchema(AtualizarMonitoriaMcpDto),
    annotations: { ...ESCRITA, idempotentHint: true },
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  atualizar(
    @Payload() args: AtualizarMonitoriaMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.atualizar(args.monitoriaId, args, usuarioMcp(ctx));
  }

  @Tool({
    name: 'ativar_monitoria',
    description:
      'Coloca a monitoria em atividade, liberando agendamentos. Somente o professor responsavel.',
    parameters: dtoParaJsonSchema(MonitoriaMcpDto),
    annotations: TRANSICAO,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  ativar(
    @Payload() { monitoriaId }: MonitoriaMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.ativar(monitoriaId, usuarioMcp(ctx));
  }

  @Tool({
    name: 'encerrar_monitoria',
    description:
      'Encerra a monitoria ao fim do periodo. Nada e apagado: o historico continua consultavel. ' +
      'Somente o professor responsavel.',
    parameters: dtoParaJsonSchema(MonitoriaMcpDto),
    annotations: TRANSICAO,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  encerrar(
    @Payload() { monitoriaId }: MonitoriaMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.encerrar(monitoriaId, usuarioMcp(ctx));
  }

  @Tool({
    name: 'cancelar_monitoria',
    description:
      'Cancela a monitoria com um motivo registrado. Nada e apagado. Somente o professor responsavel.',
    parameters: dtoParaJsonSchema(CancelarMonitoriaMcpDto),
    annotations: TRANSICAO,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  cancelar(
    @Payload() args: CancelarMonitoriaMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.cancelar(args.monitoriaId, usuarioMcp(ctx), args.motivo);
  }
}
