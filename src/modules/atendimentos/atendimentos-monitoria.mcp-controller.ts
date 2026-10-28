import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool } from '@rekog/mcp-nest';

import { RequisitoParticipacao } from '../../common/decorators/exige-participacao.decorator';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { ESCRITA, LEITURA } from '../../common/mcp/anotacoes';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { ParticipacaoService } from '../monitorias/participacao.service';
import {
  AgendarAtendimentoMcpDto,
  AgendarEmLoteMcpDto,
  HorariosLivresMcpDto,
  ListarAtendimentosDaMonitoriaMcpDto,
} from './atendimentos.mcp-dto';
import { AtendimentosService } from './atendimentos.service';
import { AtendimentoRespostaDto } from './dto/atendimento-resposta.dto';
import { HorariosLivresRespostaDto } from './dto/horario-livre.dto';
import { LoteDeAtendimentosRespostaDto } from './dto/lote-resposta.dto';

/** Quem agenda ocupa agenda: MONITOR ou MONITORADO, nunca o professor responsavel. */
const QUEM_AGENDA: RequisitoParticipacao = {
  papeis: [PapelMonitoria.MONITOR, PapelMonitoria.MONITORADO],
  professorResponsavel: 'NEGADO',
};

/**
 * Ferramentas MCP de atendimento no escopo de uma monitoria.
 *
 * Espelham `AtendimentosMonitoriaController`, inclusive na assimetria: agendar
 * exige papel que ocupe agenda, listar basta participar, e consultar horarios
 * livres e aberto a qualquer autenticado — porque quem ainda vai se inscrever
 * precisa ver a agenda antes de ter vinculo.
 */
@McpController('atendimentos-monitoria')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class AtendimentosMonitoriaMcpController {
  constructor(
    private readonly atendimentosService: AtendimentosService,
    private readonly participacaoService: ParticipacaoService,
  ) {}

  @Tool({
    name: 'agendar_atendimento',
    description:
      'Agenda uma sessao de monitoria (o monitor abre a sessao ou o monitorado solicita). ' +
      'Horario em conflito com outra sessao do monitor ou do aluno e recusado (RN03). ' +
      'Somente MONITOR ou MONITORADO da monitoria.',
    parameters: dtoParaJsonSchema(AgendarAtendimentoMcpDto),
    annotations: ESCRITA,
  })
  async agendar(
    @Payload() args: AgendarAtendimentoMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<AtendimentoRespostaDto> {
    const usuario = usuarioMcp(ctx);
    const contexto = await this.participacaoService.exigirRequisito(
      args.monitoriaId,
      usuario,
      QUEM_AGENDA,
    );

    return this.atendimentosService.agendar(contexto, args, usuario);
  }

  @Tool({
    name: 'agendar_atendimentos_em_lote',
    description:
      'Agenda uma serie de sessoes recorrentes (ate 30 ocorrencias). SUCESSO PARCIAL: cada data e ' +
      'avaliada por si, entao um feriado ou choque recusa apenas aquela e cria as demais; a resposta ' +
      'diz o que aconteceu com cada uma. Somente MONITOR ou MONITORADO da monitoria.',
    parameters: dtoParaJsonSchema(AgendarEmLoteMcpDto),
    annotations: ESCRITA,
  })
  async agendarEmLote(
    @Payload() args: AgendarEmLoteMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<LoteDeAtendimentosRespostaDto> {
    const usuario = usuarioMcp(ctx);
    const contexto = await this.participacaoService.exigirRequisito(
      args.monitoriaId,
      usuario,
      QUEM_AGENDA,
    );

    return this.atendimentosService.agendarEmLote(contexto, args, usuario);
  }

  @Tool({
    name: 'listar_horarios_livres',
    description:
      'Slots livres dos monitores, prontos para agendar. E SUGESTAO, NAO RESERVA: o calculo e uma ' +
      'fotografia do instante da consulta e a verificacao definitiva acontece ao agendar. Ja descontados ' +
      'os atendimentos do monitor, a agenda do proprio solicitante e a antecedencia minima.',
    parameters: dtoParaJsonSchema(HorariosLivresMcpDto),
    annotations: LEITURA,
  })
  horariosLivres(
    @Payload() args: HorariosLivresMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<HorariosLivresRespostaDto> {
    return this.atendimentosService.horariosLivres(args.monitoriaId, args, usuarioMcp(ctx));
  }

  @Tool({
    name: 'listar_atendimentos_da_monitoria',
    description:
      'Lista os atendimentos de uma monitoria, incluindo REALIZADOS e CANCELADOS (RN10). ' +
      'Exige participar da monitoria ou ser o professor responsavel.',
    parameters: dtoParaJsonSchema(ListarAtendimentosDaMonitoriaMcpDto),
    annotations: LEITURA,
  })
  async listar(
    @Payload() args: ListarAtendimentosDaMonitoriaMcpDto,
    @Ctx() ctx: McpContext,
  ): Promise<RespostaPaginada<AtendimentoRespostaDto>> {
    const usuario = usuarioMcp(ctx);
    await this.participacaoService.exigirRequisito(args.monitoriaId, usuario, {});

    return this.atendimentosService.listarPorMonitoria(args.monitoriaId, args, usuario);
  }
}
