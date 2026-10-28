import { UseFilters, UsePipes } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { McpController, Tool, ToolRoles } from '@rekog/mcp-nest';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { ESCRITA, LEITURA } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { AtualizarCursoMcpDto, CursoMcpDto } from './cursos.mcp-dto';
import { CursosService } from './cursos.service';
import { CriarCursoDto } from './dto/criar-curso.dto';
import { CursoRespostaDto } from './dto/curso-resposta.dto';
import { FiltroCursosDto } from './dto/filtro-cursos.dto';

/**
 * Ferramentas MCP do catalogo de cursos.
 *
 * As consultas sao `@Publico()` no REST porque o catalogo nao tem dado pessoal.
 * Aqui nao ha equivalente a `@Publico()`: a sessao MCP ja esta autenticada pelo
 * mesmo JWT da API (`allowUnauthenticatedAccess: false`), entao a ausencia de
 * `@ToolRoles` significa "qualquer usuario autenticado" — que e um recorte
 * MENOR do que o publico, nunca maior.
 */
@McpController('cursos')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class CursosMcpController {
  constructor(private readonly cursosService: CursosService) {}

  @Tool({
    name: 'criar_curso',
    description: 'Cadastra um curso. O codigo e gerado pelo sistema. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(CriarCursoDto),
    annotations: ESCRITA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  criar(@Payload() dto: CriarCursoDto): Promise<CursoRespostaDto> {
    return this.cursosService.criar(dto);
  }

  @Tool({
    name: 'listar_cursos',
    description: 'Lista os cursos do catalogo, com busca por nome ou codigo.',
    parameters: dtoParaJsonSchema(FiltroCursosDto),
    annotations: LEITURA,
  })
  listar(@Payload() filtro: FiltroCursosDto): Promise<RespostaPaginada<CursoRespostaDto>> {
    return this.cursosService.listar(filtro);
  }

  @Tool({
    name: 'detalhar_curso',
    description: 'Detalha um curso pelo id, com nome, codigo gerado e situacao.',
    parameters: dtoParaJsonSchema(CursoMcpDto),
    annotations: LEITURA,
  })
  detalhar(@Payload() args: CursoMcpDto): Promise<CursoRespostaDto> {
    return this.cursosService.detalhar(args.id);
  }

  @Tool({
    name: 'atualizar_curso',
    description: 'Altera um curso. O codigo gerado no cadastro nao muda. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(AtualizarCursoMcpDto),
    annotations: { ...ESCRITA, idempotentHint: true },
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  atualizar(@Payload() args: AtualizarCursoMcpDto): Promise<CursoRespostaDto> {
    return this.cursosService.atualizar(args.id, args);
  }
}
