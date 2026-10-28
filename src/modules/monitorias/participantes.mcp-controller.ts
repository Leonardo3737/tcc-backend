import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool, ToolRoles } from '@rekog/mcp-nest';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { ESCRITA, LEITURA, TRANSICAO } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { ParticipanteRespostaDto } from './dto/participante-resposta.dto';
import {
  HabilitarParticipanteMcpDto,
  ListarParticipantesMcpDto,
  MonitoriaMcpDto,
  ParticipanteMcpDto,
} from './monitorias.mcp-dto';
import { ParticipacaoService } from './participacao.service';
import { ParticipantesService } from './participantes.service';

/**
 * Ferramentas MCP de participantes.
 *
 * Espelham `ParticipantesController`, que e protegido pelo `ParticipacaoGuard`.
 * Guard depende de `:monitoriaId` na rota, e ferramenta MCP nao tem rota — por
 * isso cada handler chama `ParticipacaoService.exigirRequisito` com exatamente
 * o mesmo requisito declarado no `@ExigeParticipacao` da rota equivalente. E a
 * mesma funcao que o guard executa, nao uma reimplementacao.
 */
@McpController('participantes')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class ParticipantesMcpController {
  constructor(
    private readonly participantesService: ParticipantesService,
    private readonly participacaoService: ParticipacaoService,
  ) {}

  @Tool({
    name: 'habilitar_monitor',
    description:
      'Habilita um aluno como MONITOR da monitoria (RN01). Somente o professor responsavel por ela.',
    parameters: dtoParaJsonSchema(HabilitarParticipanteMcpDto),
    annotations: ESCRITA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  async habilitarMonitor(
    @Payload() { monitoriaId, alunoId }: HabilitarParticipanteMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<ParticipanteRespostaDto> {
    const usuario = usuarioMcp(ctx);
    const contexto = await this.participacaoService.exigirRequisito(monitoriaId, usuario, {
      professorResponsavel: 'EXIGIDO',
    });

    return this.participantesService.habilitarMonitor(contexto.monitoria, alunoId, usuario);
  }

  @Tool({
    name: 'inscrever_monitorado',
    description:
      'Inscreve um aluno como MONITORADO da monitoria. Somente o professor responsavel por ela.',
    parameters: dtoParaJsonSchema(HabilitarParticipanteMcpDto),
    annotations: ESCRITA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  async inscreverMonitorado(
    @Payload() { monitoriaId, alunoId }: HabilitarParticipanteMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<ParticipanteRespostaDto> {
    const usuario = usuarioMcp(ctx);
    const contexto = await this.participacaoService.exigirRequisito(monitoriaId, usuario, {
      professorResponsavel: 'EXIGIDO',
    });

    return this.participantesService.inscreverMonitorado(contexto.monitoria, alunoId, usuario.id);
  }

  /**
   * RN04 — auto-inscricao. Sem requisito de participacao, como no REST: quem se
   * inscreve ainda NAO participa. A autorizacao e o perfil ALUNO.
   */
  @Tool({
    name: 'inscrever_me_como_monitorado',
    description:
      'Inscreve o proprio aluno autenticado como MONITORADO da monitoria informada. Somente ALUNO.',
    parameters: dtoParaJsonSchema(MonitoriaMcpDto),
    annotations: ESCRITA,
  })
  @ToolRoles([PerfilUsuario.ALUNO])
  async inscreverSe(
    @Payload() { monitoriaId }: MonitoriaMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<ParticipanteRespostaDto> {
    const usuario = usuarioMcp(ctx);
    const monitoria = await this.participacaoService.buscarMonitoriaOuFalhar(monitoriaId);

    return this.participantesService.inscreverMonitorado(monitoria, usuario.id, usuario.id);
  }

  @Tool({
    name: 'listar_participantes',
    description:
      'Lista os participantes da monitoria, com papel e situacao. Exige participar dela ou ser o professor responsavel.',
    parameters: dtoParaJsonSchema(ListarParticipantesMcpDto),
    annotations: LEITURA,
  })
  /**
   * O DTO inteiro vai para o service, sem desestruturar o `monitoriaId`.
   * Espalhar um filtro paginado com `...rest` perderia o getter `offset`, que
   * mora no prototipo de `PaginacaoDto` e nao e propriedade propria — a lista
   * voltaria sempre da primeira pagina, em silencio. O campo a mais e inofensivo:
   * os services montam o `where` campo a campo.
   */
  async listar(
    @Payload() args: ListarParticipantesMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<RespostaPaginada<ParticipanteRespostaDto>> {
    await this.participacaoService.exigirRequisito(args.monitoriaId, usuarioMcp(ctx), {});

    return this.participantesService.listar(args.monitoriaId, args);
  }

  @Tool({
    name: 'promover_participante_a_monitor',
    description:
      'Promove um MONITORADO ativo a MONITOR na mesma monitoria (RN01/RN09). Somente o professor responsavel.',
    parameters: dtoParaJsonSchema(ParticipanteMcpDto),
    annotations: TRANSICAO,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  async promover(
    @Payload() { monitoriaId, participanteId }: ParticipanteMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<ParticipanteRespostaDto> {
    const usuario = usuarioMcp(ctx);
    const contexto = await this.participacaoService.exigirRequisito(monitoriaId, usuario, {
      professorResponsavel: 'EXIGIDO',
    });

    return this.participantesService.promoverAMonitor(contexto.monitoria, participanteId, usuario);
  }

  @Tool({
    name: 'encerrar_participacao',
    description:
      'Encerra o vinculo de um participante (professor responsavel ou o proprio aluno). Nao apaga nada: o vinculo fica como historico.',
    parameters: dtoParaJsonSchema(ParticipanteMcpDto),
    annotations: TRANSICAO,
  })
  async encerrar(
    @Payload() { monitoriaId, participanteId }: ParticipanteMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<ParticipanteRespostaDto> {
    const usuario = usuarioMcp(ctx);
    const contexto = await this.participacaoService.exigirRequisito(monitoriaId, usuario, {});

    return this.participantesService.encerrarVinculo(
      monitoriaId,
      participanteId,
      usuario,
      contexto.ehProfessorResponsavel,
    );
  }
}
