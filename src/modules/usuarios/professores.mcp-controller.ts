import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool, ToolRoles } from '@rekog/mcp-nest';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { ESCRITA, LEITURA } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { AtualizarProfessorDto } from './dto/atualizar-professor.dto';
import { CriarProfessorPeloProfessorDto } from './dto/criar-usuario-pelo-professor.dto';
import { FiltroProfessoresDto } from './dto/filtro-professores.dto';
import { UsuarioRespostaDto } from './dto/usuario-resposta.dto';
import { UsuarioMcpDto } from './usuarios.mcp-dto';
import { UsuariosService } from './usuarios.service';

/**
 * Ferramentas MCP de professor.
 *
 * `GET /professores/publicos` nao tem ferramenta propria: aquela rota existe
 * para quem NAO esta autenticado e devolve um subconjunto dos campos, sem
 * e-mail. Toda sessao MCP esta autenticada, entao `listar_professores` ja
 * cobre o caso com mais dados — duas ferramentas quase iguais so fariam o
 * cliente escolher a errada.
 */
@McpController('professores')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class ProfessoresMcpController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Tool({
    name: 'criar_professor',
    description:
      'Cadastra um professor. A senha e gerada pelo servidor e enviada por e-mail; ela nunca e devolvida aqui. ' +
      'Fica registrado qual professor fez o cadastro. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(CriarProfessorPeloProfessorDto),
    annotations: ESCRITA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  criar(
    @Payload() dto: CriarProfessorPeloProfessorDto,
    @Ctx() ctx: McpContext,
  ): Promise<UsuarioRespostaDto> {
    return this.usuariosService.criarProfessorComoProfessor(dto, usuarioMcp(ctx).id);
  }

  @Tool({
    name: 'listar_professores',
    description:
      'Lista professores, com busca por nome, e-mail, identificacao funcional ou departamento.',
    parameters: dtoParaJsonSchema(FiltroProfessoresDto),
    annotations: LEITURA,
  })
  listar(@Payload() filtro: FiltroProfessoresDto): Promise<RespostaPaginada<UsuarioRespostaDto>> {
    return this.usuariosService.listarProfessores(filtro);
  }

  @Tool({
    name: 'atualizar_meu_cadastro_de_professor',
    description: 'Altera os dados funcionais do proprio professor autenticado. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(AtualizarProfessorDto),
    annotations: { ...ESCRITA, idempotentHint: true },
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  atualizarProprio(
    @Payload() dto: AtualizarProfessorDto,
    @Ctx() ctx: McpContext,
  ): Promise<UsuarioRespostaDto> {
    return this.usuariosService.atualizarDadosProfessor(usuarioMcp(ctx).id, dto);
  }

  @Tool({
    name: 'buscar_professor',
    description: 'Detalha um professor pelo id do usuario.',
    parameters: dtoParaJsonSchema(UsuarioMcpDto),
    annotations: LEITURA,
  })
  buscar(@Payload() args: UsuarioMcpDto): Promise<UsuarioRespostaDto> {
    return this.usuariosService.buscarProfessorOuFalhar(args.usuarioId);
  }
}
