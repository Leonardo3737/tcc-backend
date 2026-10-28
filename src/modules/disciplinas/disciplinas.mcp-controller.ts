import { UseFilters, UsePipes } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { McpController, Tool, ToolRoles } from '@rekog/mcp-nest';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { ESCRITA, LEITURA } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { DisciplinasService } from './disciplinas.service';
import { AtualizarDisciplinaMcpDto, DisciplinaMcpDto } from './disciplinas.mcp-dto';
import { CriarDisciplinaDto } from './dto/criar-disciplina.dto';
import { DisciplinaRespostaDto } from './dto/disciplina-resposta.dto';
import { FiltroDisciplinasDto } from './dto/filtro-disciplinas.dto';

/** Ferramentas MCP do catalogo de disciplinas. Espelham `DisciplinasController`. */
@McpController('disciplinas')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class DisciplinasMcpController {
  constructor(private readonly disciplinasService: DisciplinasService) {}

  @Tool({
    name: 'criar_disciplina',
    description:
      'Cadastra uma disciplina e a associa aos cursos informados. O codigo e gerado pelo sistema. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(CriarDisciplinaDto),
    annotations: ESCRITA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  criar(@Payload() dto: CriarDisciplinaDto): Promise<DisciplinaRespostaDto> {
    return this.disciplinasService.criar(dto);
  }

  @Tool({
    name: 'listar_disciplinas',
    description:
      'Lista as disciplinas do catalogo. Aceita busca por nome ou codigo e recorte por curso.',
    parameters: dtoParaJsonSchema(FiltroDisciplinasDto),
    annotations: LEITURA,
  })
  listar(
    @Payload() filtro: FiltroDisciplinasDto,
  ): Promise<RespostaPaginada<DisciplinaRespostaDto>> {
    return this.disciplinasService.listar(filtro);
  }

  @Tool({
    name: 'detalhar_disciplina',
    description: 'Detalha uma disciplina pelo id, com os cursos a que pertence.',
    parameters: dtoParaJsonSchema(DisciplinaMcpDto),
    annotations: LEITURA,
  })
  detalhar(@Payload() args: DisciplinaMcpDto): Promise<DisciplinaRespostaDto> {
    return this.disciplinasService.detalhar(args.id);
  }

  @Tool({
    name: 'atualizar_disciplina',
    description:
      'Altera uma disciplina e seus cursos. O codigo gerado no cadastro nao muda. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(AtualizarDisciplinaMcpDto),
    annotations: { ...ESCRITA, idempotentHint: true },
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  atualizar(@Payload() args: AtualizarDisciplinaMcpDto): Promise<DisciplinaRespostaDto> {
    return this.disciplinasService.atualizar(args.id, args);
  }
}
