import {
  Body,
  HttpCode,
  HttpStatus,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ContextoMonitoria } from '../../common/decorators/contexto-monitoria.decorator';
import { ExigeParticipacao } from '../../common/decorators/exige-participacao.decorator';
import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { ParticipacaoGuard } from '../monitorias/guards/participacao.guard';
import { ContextoParticipacao } from '../monitorias/participacao.service';
import { AtendimentosService } from './atendimentos.service';
import { AgendarAtendimentoDto } from './dto/agendar-atendimento.dto';
import { AtendimentoRespostaDto } from './dto/atendimento-resposta.dto';
import { AgendarAtendimentosEmLoteDto } from './dto/agendar-em-lote.dto';
import { FiltroAtendimentosDto } from './dto/filtro-atendimentos.dto';
import { LoteDeAtendimentosRespostaDto } from './dto/lote-resposta.dto';
import { FiltroHorariosLivresDto } from './dto/filtro-horarios-livres.dto';
import { HorariosLivresRespostaDto } from './dto/horario-livre.dto';

/**
 * Rotas de atendimento no contexto de uma monitoria.
 *
 * Ficam sob /monitorias/:monitoriaId porque e a monitoria que define quem pode
 * agendar — o que permite usar o ParticipacaoGuard de forma declarativa.
 */
@ApiTags('Monitorias - Atendimentos')
@ApiBearerAuth()
@UseGuards(ParticipacaoGuard)
@Controller('monitorias/:monitoriaId/atendimentos')
export class AtendimentosMonitoriaController {
  constructor(private readonly atendimentosService: AtendimentosService) {}

  /**
   * Um unico endpoint atende os dois iniciadores (D-08).
   *
   * MONITOR abre uma sessao (origem OFERTA_MONITOR); MONITORADO solicita um
   * atendimento e ja entra inscrito nele (origem SOLICITACAO_ALUNO). O professor
   * responsavel e barrado de proposito: ele administra a monitoria, mas nao tem
   * vinculo que ocupe agenda.
   */
  @Post()
  @ExigeParticipacao({
    papeis: [PapelMonitoria.MONITOR, PapelMonitoria.MONITORADO],
    professorResponsavel: 'NEGADO',
  })
  @ApiOperation({
    summary: 'Agenda um atendimento (monitor abre a sessao ou monitorado solicita).',
  })
  @ApiCreatedResponse({ type: AtendimentoRespostaDto })
  @ApiConflictResponse({
    description: 'Conflito de horario (RN03) ou horario fora da disponibilidade do monitor.',
    type: RespostaErro,
  })
  agendar(
    @Body() dto: AgendarAtendimentoDto,
    @ContextoMonitoria() contexto: ContextoParticipacao,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AtendimentoRespostaDto> {
    return this.atendimentosService.agendar(contexto, dto, usuario);
  }

  /**
   * A2 — serie de sessoes recorrentes em uma requisicao.
   *
   * Mesma autorizacao do POST avulso: criar quinze sessoes de uma vez nao e
   * poder diferente de criar quinze sessoes uma a uma.
   */
  @Post('lote')
  @HttpCode(HttpStatus.OK)
  @ExigeParticipacao({
    papeis: [PapelMonitoria.MONITOR, PapelMonitoria.MONITORADO],
    professorResponsavel: 'NEGADO',
  })
  @ApiOperation({
    summary: 'Agenda uma serie de atendimentos recorrentes (ate 30 ocorrencias).',
    description:
      'SUCESSO PARCIAL: cada ocorrencia roda na propria transacao, entao um feriado ou ' +
      'choque pontual recusa apenas aquela data e cria as demais. Por isso devolve 200 ' +
      'com o resultado de cada uma, e nao 201. Os monitorados recebem UM aviso referente ' +
      'a primeira sessao, mencionando as demais — um por ocorrencia inundaria a caixa.',
  })
  @ApiOkResponse({ type: LoteDeAtendimentosRespostaDto })
  agendarEmLote(
    @Body() dto: AgendarAtendimentosEmLoteDto,
    @ContextoMonitoria() contexto: ContextoParticipacao,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<LoteDeAtendimentosRespostaDto> {
    return this.atendimentosService.agendarEmLote(contexto, dto, usuario);
  }

  /**
   * A1 — horarios concretos, para substituir data/inicio/fim digitados.
   *
   * Autorizacao igual a de GET /disponibilidades, que ja e aberta a qualquer
   * autenticado (decisao B4): quem vai se inscrever precisa ver a agenda ANTES
   * de ter vinculo, senao a descoberta exige entrar primeiro.
   */
  @Get('horarios-livres')
  @ApiOperation({
    summary: 'Slots livres dos monitores, prontos para agendar.',
    description:
      'SUGESTAO, NAO RESERVA: o calculo e uma fotografia do instante da consulta, e dois ' +
      'usuarios podem receber o mesmo slot. A verificacao autoritativa continua no POST. ' +
      'Ja descontados: atendimentos do monitor, a agenda do proprio solicitante (inclusive ' +
      'em outras monitorias) e a antecedencia minima. Janela maxima de 60 dias; teto de ' +
      '500 slots, sinalizado em `truncado`.',
  })
  @ApiOkResponse({ type: HorariosLivresRespostaDto })
  @ApiBadRequestResponse({
    description: 'Janela maior que 60 dias, invertida, ou duracao fora dos limites.',
    type: RespostaErro,
  })
  horariosLivres(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Query() filtro: FiltroHorariosLivresDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<HorariosLivresRespostaDto> {
    return this.atendimentosService.horariosLivres(monitoriaId, filtro, usuario);
  }

  @Get()
  @ExigeParticipacao()
  @ApiOperation({
    summary: 'Lista atendimentos da monitoria, incluindo REALIZADOS e CANCELADOS (RN10).',
  })
  @ApiRespostaPaginada(AtendimentoRespostaDto)
  listar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Query() filtro: FiltroAtendimentosDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<RespostaPaginada<AtendimentoRespostaDto>> {
    return this.atendimentosService.listarPorMonitoria(monitoriaId, filtro, usuario);
  }
}
