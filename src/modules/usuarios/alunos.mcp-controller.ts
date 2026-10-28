import { ForbiddenException, UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool, ToolRoles } from '@rekog/mcp-nest';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { ESCRITA, LEITURA } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { AtualizarAlunoDto } from './dto/atualizar-aluno.dto';
import { CriarAlunoPeloProfessorDto } from './dto/criar-usuario-pelo-professor.dto';
import { FiltroAlunosDto } from './dto/filtro-alunos.dto';
import { UsuarioRespostaDto } from './dto/usuario-resposta.dto';
import { UsuarioMcpDto } from './usuarios.mcp-dto';
import { UsuariosService } from './usuarios.service';

/** Ferramentas MCP de aluno. Espelham `AlunosController`. */
@McpController('alunos')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class AlunosMcpController {
  constructor(private readonly usuariosService: UsuariosService) {}

  /**
   * Unico caminho de criacao de aluno, igual ao REST: nao ha auto-cadastro.
   * A senha e gerada pelo servidor e entregue por e-mail — nenhuma credencial
   * entra nem sai pelos argumentos da ferramenta.
   */
  @Tool({
    name: 'criar_aluno',
    description:
      'Cadastra um aluno. A senha e gerada pelo servidor e enviada por e-mail ao aluno; ela nunca e devolvida aqui. ' +
      'Fica registrado qual professor fez o cadastro. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(CriarAlunoPeloProfessorDto),
    annotations: ESCRITA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  criar(
    @Payload() dto: CriarAlunoPeloProfessorDto,
    @Ctx() ctx: McpContext,
  ): Promise<UsuarioRespostaDto> {
    return this.usuariosService.criarAlunoComoProfessor(dto, usuarioMcp(ctx).id);
  }

  @Tool({
    name: 'listar_alunos',
    description:
      'Lista alunos, com busca por nome, e-mail ou matricula e recorte por vinculo ativo em uma monitoria. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(FiltroAlunosDto),
    annotations: LEITURA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  listar(@Payload() filtro: FiltroAlunosDto): Promise<RespostaPaginada<UsuarioRespostaDto>> {
    return this.usuariosService.listarAlunos(filtro);
  }

  @Tool({
    name: 'atualizar_meu_cadastro_de_aluno',
    description: 'Altera os dados academicos do proprio aluno autenticado. Somente ALUNO.',
    parameters: dtoParaJsonSchema(AtualizarAlunoDto),
    annotations: { ...ESCRITA, idempotentHint: true },
  })
  @ToolRoles([PerfilUsuario.ALUNO])
  atualizarProprio(
    @Payload() dto: AtualizarAlunoDto,
    @Ctx() ctx: McpContext,
  ): Promise<UsuarioRespostaDto> {
    return this.usuariosService.atualizarDadosAluno(usuarioMcp(ctx).id, dto);
  }

  /**
   * A checagem e a mesma do controller REST e fica aqui pelo mesmo motivo: ela
   * compara o id pedido com o id do token, e `@ToolRoles`, que so conhece
   * perfis, nao tem como tomar essa decisao.
   */
  @Tool({
    name: 'buscar_aluno',
    description:
      'Detalha um aluno pelo id do usuario. Acessivel a um PROFESSOR ou ao proprio aluno.',
    parameters: dtoParaJsonSchema(UsuarioMcpDto),
    annotations: LEITURA,
  })
  buscar(@Payload() args: UsuarioMcpDto, @Ctx() ctx: McpContext): Promise<UsuarioRespostaDto> {
    const solicitante = usuarioMcp(ctx);
    const ehProfessor = solicitante.perfis.includes(PerfilUsuario.PROFESSOR);

    if (!ehProfessor && solicitante.id !== args.usuarioId) {
      throw new ForbiddenException('Voce so pode consultar os seus proprios dados.');
    }

    return this.usuariosService.buscarAlunoOuFalhar(args.usuarioId);
  }
}
