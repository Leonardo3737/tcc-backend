import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { FiltroAtendimentosDto } from './dto/filtro-atendimentos.dto';

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
