import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { AtendimentosService } from './atendimentos.service';
import { AtendimentoRespostaDto, HistoricoStatusRespostaDto } from './dto/atendimento-resposta.dto';
import { AtualizarAtendimentoDto } from './dto/atualizar-atendimento.dto';
import { CancelarAtendimentoDto } from './dto/cancelar-atendimento.dto';
import { FiltroAtendimentosDto } from './dto/filtro-atendimentos.dto';
import { ReagendarAtendimentoDto } from './dto/reagendar-atendimento.dto';
import { RealizarAtendimentoDto } from './dto/realizar-atendimento.dto';

/**
 * Rotas de um atendimento ja existente.
 *
 * Aqui a monitoria NAO esta na URL — ela e descoberta a partir do proprio
 * atendimento. Por isso estas rotas nao usam o ParticipacaoGuard: a autorizacao
 * acontece no service, no ponto em que o contexto passa a existir. Continua
 * sendo verificacao de backend, apenas em outra camada.
 */
@ApiTags('Atendimentos')
@ApiBearerAuth()
@Controller('atendimentos')
export class AtendimentosController {
  constructor(private readonly atendimentosService: AtendimentosService) {}

  /** Declarada antes de :atendimentoId para que "meus" nao seja lido como UUID. */
  @Get('meus')
  /**
   * Devolve lista vazia para quem e apenas PROFESSOR — e coerente com o dominio,
   * nao falha de integracao: o professor administra a monitoria, mas nao atende
   * nem e atendido, entao nao tem vinculo que ocupe agenda. Para ver os
   * atendimentos das monitorias sob sua responsabilidade ele usa
   * GET /monitorias/:monitoriaId/atendimentos.
   */
  @ApiOperation({
    summary: 'Agenda do usuario: tudo em que ele atende ou e atendido, em qualquer monitoria.',
    description:
      'Baseada nos VINCULOS do usuario (MONITOR ou MONITORADO). Um usuario que e ' +
      'apenas PROFESSOR recebe lista vazia: ele nao possui vinculo de participante. ' +
      'Nesse caso use GET /monitorias/:monitoriaId/atendimentos.',
  })
  @ApiRespostaPaginada(AtendimentoRespostaDto)
  meus(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query() filtro: FiltroAtendimentosDto,
  ): Promise<RespostaPaginada<AtendimentoRespostaDto>> {
    return this.atendimentosService.meusAtendimentos(usuario, filtro);
  }

  @Get(':atendimentoId')
  @ApiOperation({ summary: 'Detalha um atendimento, com inscricoes e historico de status.' })
  @ApiOkResponse({ type: AtendimentoRespostaDto })
  @ApiForbiddenResponse({ description: 'Nao participa da monitoria (RN04).', type: RespostaErro })
  detalhar(
    @Param('atendimentoId', ParseUUIDPipe) atendimentoId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.detalhar(atendimentoId, usuario);
  }

  @Get(':atendimentoId/historico')
  @ApiOperation({ summary: 'Trilha de transicoes de status, com autor, motivo e data (RN10).' })
  @ApiOkResponse({ type: [HistoricoStatusRespostaDto] })
  historico(
    @Param('atendimentoId', ParseUUIDPipe) atendimentoId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<HistoricoStatusRespostaDto[]> {
    return this.atendimentosService.historico(atendimentoId, usuario);
  }

  /** Entrada em sessao coletiva ja aberta. A capacidade e conferida sob lock. */
  @Post(':atendimentoId/inscricao')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'O monitorado se inscreve em um atendimento com vaga disponivel.' })
  @ApiOkResponse({ type: AtendimentoRespostaDto })
  @ApiConflictResponse({
    description: 'Sem vagas ou conflito de horario (RN03).',
    type: RespostaErro,
  })
  inscrever(
    @Param('atendimentoId', ParseUUIDPipe) atendimentoId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.inscrever(atendimentoId, usuario);
  }

  @Post(':atendimentoId/inscricao/cancelar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'O monitorado desiste. Se ele era o solicitante e ninguem mais restou, ' +
      'o atendimento e cancelado automaticamente.',
  })
  @ApiOkResponse({ type: AtendimentoRespostaDto })
  cancelarInscricao(
    @Param('atendimentoId', ParseUUIDPipe) atendimentoId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.cancelarInscricao(atendimentoId, usuario);
  }

  /**
   * Muda o horario mantendo o atendimento e as inscricoes.
   *
   * Nao e um PATCH em inicio/fim: revalida duracao e janela de disponibilidade,
   * exige motivo e registra o horario anterior no historico (RN10).
   */
  @Post(':atendimentoId/reagendar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reagenda um atendimento AGENDADO. Monitor da sessao ou professor responsavel.',
    description:
      'As inscricoes acompanham o novo horario. Se algum inscrito tiver conflito de ' +
      'agenda, o reagendamento inteiro e recusado com 409 informando quem conflita.',
  })
  @ApiOkResponse({ type: AtendimentoRespostaDto })
  @ApiConflictResponse({
    description: 'Atendimento nao esta AGENDADO, horario fora da disponibilidade, ou conflito.',
    type: RespostaErro,
  })
  reagendar(
    @Param('atendimentoId', ParseUUIDPipe) atendimentoId: string,
    @Body() dto: ReagendarAtendimentoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.reagendar(atendimentoId, dto, usuario);
  }

  /**
   * Dados basicos da sessao. NAO inclui horario nem status.
   *
   * Este e o unico PATCH do modulo, e a divisao com as demais rotas e
   * proposital: `reagendar`, `realizar` e `cancelar` sao operacoes de dominio
   * com pre-condicoes e efeitos proprios, enquanto assunto, local, modalidade e
   * vagas sao apenas dados. Juntar tudo num PATCH generico apagaria essa
   * distincao e abriria um caminho sem as validacoes de horario.
   *
   * `modalidade` nao esta aqui: ela e definida no agendamento e nao muda. Quem
   * se inscreveu escolheu uma sessao presencial ou remota.
   */
  @Patch(':atendimentoId')
  @ApiOperation({
    summary: 'Edita dados basicos de um atendimento AGENDADO. Monitor da sessao ou professor.',
    description:
      'Assunto, local e vagas. Horario muda apenas por /reagendar, que valida ' +
      'disponibilidade e avisa os inscritos; status muda por /realizar e /cancelar; ' +
      'modalidade e definida no agendamento e nao muda. Enviar `local` vazio remove ' +
      'o local.',
  })
  @ApiOkResponse({ type: AtendimentoRespostaDto })
  @ApiConflictResponse({
    description: 'Atendimento nao esta AGENDADO, ou vagas abaixo do numero de inscritos.',
    type: RespostaErro,
  })
  atualizar(
    @Param('atendimentoId', ParseUUIDPipe) atendimentoId: string,
    @Body() dto: AtualizarAtendimentoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.atualizar(atendimentoId, dto, usuario);
  }

  /**
   * AGENDADO -> REALIZADO. Operacao de dominio, nao um PATCH em `status`:
   * marcar como realizado tambem registra a presenca de cada inscrito.
   */
  @Post(':atendimentoId/realizar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirma a realizacao e registra presencas. Monitor da sessao ou professor.',
  })
  @ApiOkResponse({ type: AtendimentoRespostaDto })
  @ApiConflictResponse({ description: 'Atendimento nao esta AGENDADO.', type: RespostaErro })
  realizar(
    @Param('atendimentoId', ParseUUIDPipe) atendimentoId: string,
    @Body() dto: RealizarAtendimentoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.realizar(atendimentoId, dto, usuario);
  }

  /**
   * AGENDADO -> CANCELADO.
   *
   * Nao existe DELETE nesta API por decisao de dominio: cancelar preserva a
   * linha, o motivo e o autor (RN10). O registro continua aparecendo nas
   * listagens e no historico.
   */
  @Post(':atendimentoId/cancelar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancela o atendimento sem apaga-lo. Monitor da sessao ou professor.' })
  @ApiOkResponse({ type: AtendimentoRespostaDto })
  cancelar(
    @Param('atendimentoId', ParseUUIDPipe) atendimentoId: string,
    @Body() dto: CancelarAtendimentoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.cancelar(atendimentoId, dto.motivo, usuario);
  }
}
