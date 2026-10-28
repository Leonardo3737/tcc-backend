import { UseFilters, UsePipes } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { McpController, Tool, ToolRoles } from '@rekog/mcp-nest';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { ESCRITA, LEITURA, TRANSICAO } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { CriarEditalDto } from './dto/criar-edital.dto';
import { EditalRespostaDto } from './dto/edital-resposta.dto';
import { FiltroEditaisDto } from './dto/filtro-editais.dto';
import { AtualizarEditalMcpDto, EditalExcluidoMcpDto, EditalMcpDto } from './editais.mcp-dto';
import { EditaisService } from './editais.service';

/**
 * Ferramentas MCP de edital de selecao.
 *
 * Cobrem as rotas ADMINISTRATIVAS, todas de PROFESSOR. As duas rotas publicas
 * do modulo — consultar editais abertos e inscrever-se — ficam de fora por
 * decisao de escopo: a inscricao e a unica escrita anonima da API, existe para
 * quem ainda nao tem conta, e uma sessao MCP e sempre autenticada. Expor a
 * inscricao aqui faria um professor logado se inscrever em nome de terceiros,
 * que e exatamente o que o fluxo publico nao permite. Para ver os editais
 * abertos basta `listar_editais` com `ativo: true`.
 */
@McpController('editais')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class EditaisMcpController {
  constructor(private readonly editaisService: EditaisService) {}

  @Tool({
    name: 'criar_edital',
    description:
      'Publica um edital de selecao de monitores, com periodo de inscricoes, periodo letivo e link do documento oficial. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(CriarEditalDto),
    annotations: ESCRITA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  criar(@Payload() dto: CriarEditalDto): Promise<EditalRespostaDto> {
    return this.editaisService.criar(dto);
  }

  @Tool({
    name: 'listar_editais',
    description:
      'Lista editais, com recorte por ano, semestre e situacao. Use `ativo: true` para ver apenas os vigentes. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(FiltroEditaisDto),
    annotations: LEITURA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  listar(@Payload() filtro: FiltroEditaisDto): Promise<RespostaPaginada<EditalRespostaDto>> {
    return this.editaisService.listar(filtro);
  }

  @Tool({
    name: 'detalhar_edital',
    description: 'Detalha um edital pelo id. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(EditalMcpDto),
    annotations: LEITURA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  detalhar(@Payload() args: EditalMcpDto): Promise<EditalRespostaDto> {
    return this.editaisService.detalhar(args.id);
  }

  @Tool({
    name: 'atualizar_edital',
    description:
      'Altera um edital. Aceita alteracao parcial do periodo de inscricoes: o lado nao informado e mantido e a coerencia das datas e verificada contra ele. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(AtualizarEditalMcpDto),
    annotations: { ...ESCRITA, idempotentHint: true },
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  atualizar(@Payload() args: AtualizarEditalMcpDto): Promise<EditalRespostaDto> {
    return this.editaisService.atualizar(args.id, args);
  }

  /**
   * Exclusao LOGICA. A ferramenta devolve um objeto em vez de nada para que
   * fique dito, no proprio resultado, que o edital continua existindo: a rota
   * REST responde 204 e nao tem onde explicar isso.
   */
  @Tool({
    name: 'excluir_edital',
    description:
      'Desativa um edital. E exclusao LOGICA: o edital deixa de aceitar inscricoes e some das listagens de abertos, ' +
      'mas nem ele nem as candidaturas ja recebidas sao apagados. Repetir nao muda nada. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(EditalMcpDto),
    annotations: { ...TRANSICAO, idempotentHint: true },
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  async excluir(@Payload() args: EditalMcpDto): Promise<EditalExcluidoMcpDto> {
    await this.editaisService.excluir(args.id);

    return {
      id: args.id,
      ativo: false,
      mensagem: 'Edital desativado. As candidaturas recebidas foram preservadas.',
    };
  }
}
