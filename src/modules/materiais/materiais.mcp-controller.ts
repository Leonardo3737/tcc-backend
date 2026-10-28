import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool } from '@rekog/mcp-nest';

import { RequisitoParticipacao } from '../../common/decorators/exige-participacao.decorator';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { ESCRITA, LEITURA, TRANSICAO } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { ParticipacaoService } from '../monitorias/participacao.service';
import { MaterialRespostaDto } from './dto/material-resposta.dto';
import {
  AtualizarMaterialMcpDto,
  ListarMateriaisMcpDto,
  MaterialMcpDto,
  PublicarMaterialMcpDto,
} from './materiais.mcp-dto';
import { MateriaisService } from './materiais.service';

/** RN08: publica o professor responsavel ou um MONITOR habilitado. */
const QUEM_PUBLICA: RequisitoParticipacao = {
  papeis: [PapelMonitoria.MONITOR],
  professorResponsavel: 'PERMITIDO',
};

/**
 * Ferramentas MCP do acervo da monitoria.
 *
 * Espelham `MateriaisController`. Leitura exige participar da monitoria (RN07);
 * escrita exige ser o professor responsavel ou MONITOR habilitado (RN08), e a
 * propriedade do material em si continua sendo verificada no service.
 */
@McpController('materiais')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class MateriaisMcpController {
  constructor(
    private readonly materiaisService: MateriaisService,
    private readonly participacaoService: ParticipacaoService,
  ) {}

  @Tool({
    name: 'publicar_material',
    description:
      'Publica um material de apoio na monitoria (titulo, descricao e um endereco http/https). ' +
      'O sistema nao armazena arquivos: o conteudo fica onde ja esta hospedado. ' +
      'Somente o professor responsavel ou um MONITOR da monitoria (RN08).',
    parameters: dtoParaJsonSchema(PublicarMaterialMcpDto),
    annotations: ESCRITA,
  })
  async publicar(
    @Payload() args: PublicarMaterialMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<MaterialRespostaDto> {
    const usuario = usuarioMcp(ctx);
    const contexto = await this.participacaoService.exigirRequisito(
      args.monitoriaId,
      usuario,
      QUEM_PUBLICA,
    );

    return this.materiaisService.publicar(contexto, args, usuario);
  }

  @Tool({
    name: 'listar_materiais',
    description:
      'Lista os materiais de apoio da monitoria. Somente participantes dela ou o professor responsavel (RN07).',
    parameters: dtoParaJsonSchema(ListarMateriaisMcpDto),
    annotations: LEITURA,
  })
  async listar(
    @Payload() args: ListarMateriaisMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<RespostaPaginada<MaterialRespostaDto>> {
    await this.participacaoService.exigirRequisito(args.monitoriaId, usuarioMcp(ctx), {});

    return this.materiaisService.listar(args.monitoriaId, args);
  }

  @Tool({
    name: 'detalhar_material',
    description: 'Detalha um material de apoio. Somente participantes da monitoria (RN07).',
    parameters: dtoParaJsonSchema(MaterialMcpDto),
    annotations: LEITURA,
  })
  async detalhar(
    @Payload() args: MaterialMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<MaterialRespostaDto> {
    await this.participacaoService.exigirRequisito(args.monitoriaId, usuarioMcp(ctx), {});

    return this.materiaisService.detalhar(args.monitoriaId, args.materialId);
  }

  @Tool({
    name: 'atualizar_material',
    description:
      'Altera um material de apoio. O monitor so altera o que ele mesmo publicou; o professor responsavel altera qualquer um.',
    parameters: dtoParaJsonSchema(AtualizarMaterialMcpDto),
    annotations: { ...ESCRITA, idempotentHint: true },
  })
  async atualizar(
    @Payload() args: AtualizarMaterialMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<MaterialRespostaDto> {
    const usuario = usuarioMcp(ctx);
    const contexto = await this.participacaoService.exigirRequisito(
      args.monitoriaId,
      usuario,
      QUEM_PUBLICA,
    );

    return this.materiaisService.atualizar(contexto, args.materialId, args, usuario);
  }

  @Tool({
    name: 'remover_material',
    description:
      'Retira um material do acervo. E remocao LOGICA: o registro permanece, apenas deixa de ser listado. ' +
      'O monitor so retira o que ele mesmo publicou; o professor responsavel retira qualquer um.',
    parameters: dtoParaJsonSchema(MaterialMcpDto),
    annotations: TRANSICAO,
  })
  async remover(
    @Payload() args: MaterialMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<MaterialRespostaDto> {
    const usuario = usuarioMcp(ctx);
    const contexto = await this.participacaoService.exigirRequisito(
      args.monitoriaId,
      usuario,
      QUEM_PUBLICA,
    );

    return this.materiaisService.remover(contexto, args.materialId, usuario);
  }
}
