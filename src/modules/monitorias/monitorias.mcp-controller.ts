import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool, ToolRoles } from '@rekog/mcp-nest';
import { PerfilUsuario } from 'src/common/enums/perfil-usuario.enum';
import { dtoParaJsonSchema } from 'src/common/mcp/dto-schema copy';
import { McpExcecoesFilter } from 'src/common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from 'src/common/mcp/mcp-validation.pipe';
import { usuarioMcp } from 'src/common/mcp/usuario-mcp';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { CriarMonitoriaDto } from './dto/criar-monitoria.dto';
import { FiltroMonitoriasDto } from './dto/filtro-monitorias.dto';
import { MonitoriaRespostaDto } from './dto/monitoria-resposta.dto';
import { MonitoriasService } from './monitorias.service';


@McpController('monitorias')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class MonitoriasMcpController {
  constructor(private readonly monitoriasService: MonitoriasService) {}

  @Tool({
    name: 'listar_monitorias',
    description: 'Lista monitorias com filtros por disciplina, professor, periodo e status.',
    parameters: dtoParaJsonSchema(FiltroMonitoriasDto),
    annotations: { readOnlyHint: true },
  })
  listar(@Payload() filtro: FiltroMonitoriasDto): Promise<RespostaPaginada<MonitoriaRespostaDto>> {
    return this.monitoriasService.listar(filtro);
  }

  @Tool({
    name: 'criar_monitoria',
    description: 'Cria uma monitoria. o professor responsável é sempre o usuário logado',
    parameters: dtoParaJsonSchema(CriarMonitoriaDto),
    annotations: { readOnlyHint: true },
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  criar(
    @Payload() dto: CriarMonitoriaDto,
    @Ctx() ctx: McpContext
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.criar({ ...dto, professorId: usuarioMcp(ctx).id });
  }

  
/*

  @Get('minhas')
  @ApiRespostaPaginada(MonitoriaRespostaDto)
  minhas(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query() filtro: FiltroMinhasMonitoriasDto,
  ): Promise<RespostaPaginada<MonitoriaRespostaDto>> {
    return this.monitoriasService.minhas(usuario, filtro);
  }

  @Get(':monitoriaId')
  detalhar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.detalhar(monitoriaId, usuario);
  }

  @Patch(':monitoriaId')
  atualizar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Body() dto: AtualizarMonitoriaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.atualizar(monitoriaId, dto, usuario);
  }

  @Post(':monitoriaId/ativar')
  @HttpCode(HttpStatus.OK)
  ativar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.ativar(monitoriaId, usuario);
  }

  @Post(':monitoriaId/encerrar')
  @HttpCode(HttpStatus.OK)
  encerrar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.encerrar(monitoriaId, usuario);
  }

  @Post(':monitoriaId/cancelar')
  @HttpCode(HttpStatus.OK)
  cancelar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Body() dto: CancelarMonitoriaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.cancelar(monitoriaId, usuario, dto.motivo);
  } */
}
