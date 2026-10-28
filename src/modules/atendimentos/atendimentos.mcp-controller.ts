import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool } from '@rekog/mcp-nest';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { ESCRITA, LEITURA, TRANSICAO } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import {
  AtendimentoMcpDto,
  AtualizarAtendimentoMcpDto,
  CancelarAtendimentoMcpDto,
  ReagendarAtendimentoMcpDto,
  RealizarAtendimentoMcpDto,
} from './atendimentos.mcp-dto';
import { AtendimentosService } from './atendimentos.service';
import { AtendimentoRespostaDto, HistoricoStatusRespostaDto } from './dto/atendimento-resposta.dto';
import { FiltroAtendimentosDto } from './dto/filtro-atendimentos.dto';

/**
 * Ferramentas MCP de atendimento no escopo do proprio atendimento.
 *
 * Espelham `AtendimentosController`. Nenhuma delas usa `@ToolRoles`: a
 * autorizacao aqui nao e de perfil, e sim de participacao na sessao — quem
 * pode realizar e o monitor dela ou o professor responsavel, quem pode
 * cancelar a inscricao e o proprio monitorado. Essas verificacoes ja vivem no
 * `AtendimentosService`, que recebe o usuario autenticado do token.
 */
@McpController('atendimentos')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class AtendimentosMcpController {
  constructor(private readonly atendimentosService: AtendimentosService) {}

  @Tool({
    name: 'listar_meus_atendimentos',
    description:
      'Agenda pessoal do usuario autenticado: os atendimentos em que ele e monitor ou monitorado, em todas as monitorias.',
    parameters: dtoParaJsonSchema(FiltroAtendimentosDto),
    annotations: LEITURA,
  })
  meus(
    @Payload() filtro: FiltroAtendimentosDto,
    @Ctx() ctx: McpContext,
  ): Promise<RespostaPaginada<AtendimentoRespostaDto>> {
    return this.atendimentosService.meusAtendimentos(usuarioMcp(ctx), filtro);
  }

  @Tool({
    name: 'detalhar_atendimento',
    description: 'Detalha um atendimento. Exige participar da monitoria dele.',
    parameters: dtoParaJsonSchema(AtendimentoMcpDto),
    annotations: LEITURA,
  })
  detalhar(
    @Payload() args: AtendimentoMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.detalhar(args.atendimentoId, usuarioMcp(ctx));
  }

  @Tool({
    name: 'historico_do_atendimento',
    description:
      'Historico de mudancas de situacao do atendimento, com autor e momento de cada uma. Exige participar da monitoria dele.',
    parameters: dtoParaJsonSchema(AtendimentoMcpDto),
    annotations: LEITURA,
  })
  historico(
    @Payload() args: AtendimentoMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<HistoricoStatusRespostaDto[]> {
    return this.atendimentosService.historico(args.atendimentoId, usuarioMcp(ctx));
  }

  @Tool({
    name: 'inscrever_me_em_atendimento',
    description:
      'Inscreve o usuario autenticado, como monitorado, em uma sessao ja aberta pelo monitor. Recusado se houver conflito de horario (RN03) ou se as vagas acabaram.',
    parameters: dtoParaJsonSchema(AtendimentoMcpDto),
    annotations: ESCRITA,
  })
  inscrever(
    @Payload() args: AtendimentoMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.inscrever(args.atendimentoId, usuarioMcp(ctx));
  }

  @Tool({
    name: 'cancelar_minha_inscricao_em_atendimento',
    description:
      'Cancela a inscricao do proprio usuario na sessao, observada a antecedencia minima definida pela instituicao. A sessao continua existindo para os demais.',
    parameters: dtoParaJsonSchema(AtendimentoMcpDto),
    annotations: TRANSICAO,
  })
  cancelarInscricao(
    @Payload() args: AtendimentoMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.cancelarInscricao(args.atendimentoId, usuarioMcp(ctx));
  }

  @Tool({
    name: 'reagendar_atendimento',
    description:
      'Move a sessao para outro horario, mantendo os inscritos. Recusado se o novo horario conflitar com a agenda de algum deles (RN03).',
    parameters: dtoParaJsonSchema(ReagendarAtendimentoMcpDto),
    annotations: TRANSICAO,
  })
  reagendar(
    @Payload() args: ReagendarAtendimentoMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.reagendar(args.atendimentoId, args, usuarioMcp(ctx));
  }

  @Tool({
    name: 'atualizar_atendimento',
    description:
      'Altera os dados descritivos da sessao (assunto, modalidade, local, vagas), sem mexer no horario.',
    parameters: dtoParaJsonSchema(AtualizarAtendimentoMcpDto),
    annotations: { ...ESCRITA, idempotentHint: true },
  })
  atualizar(
    @Payload() args: AtualizarAtendimentoMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.atualizar(args.atendimentoId, args, usuarioMcp(ctx));
  }

  @Tool({
    name: 'realizar_atendimento',
    description:
      'Marca a sessao como REALIZADA e registra a presenca de cada inscrito. E o que libera a avaliacao (RN06) e o que conta na carga horaria do monitor. Somente o monitor da sessao ou o professor responsavel.',
    parameters: dtoParaJsonSchema(RealizarAtendimentoMcpDto),
    annotations: TRANSICAO,
  })
  realizar(
    @Payload() args: RealizarAtendimentoMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.realizar(args.atendimentoId, args, usuarioMcp(ctx));
  }

  @Tool({
    name: 'cancelar_atendimento',
    description:
      'Cancela a sessao inteira com um motivo registrado. Nada e apagado: a sessao permanece no historico como CANCELADA. Somente o monitor da sessao ou o professor responsavel.',
    parameters: dtoParaJsonSchema(CancelarAtendimentoMcpDto),
    annotations: TRANSICAO,
  })
  cancelar(
    @Payload() args: CancelarAtendimentoMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.cancelar(args.atendimentoId, args.motivo, usuarioMcp(ctx));
  }
}
