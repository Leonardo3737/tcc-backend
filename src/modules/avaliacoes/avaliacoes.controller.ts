import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { AvaliacoesService } from './avaliacoes.service';
import { AvaliacaoRespostaDto, ResumoAvaliacoesDto } from './dto/avaliacao-resposta.dto';
import { CriarAvaliacaoDto } from './dto/criar-avaliacao.dto';

@ApiTags('Avaliacoes')
@ApiBearerAuth()
@Controller()
export class AvaliacoesController {
  constructor(private readonly avaliacoesService: AvaliacoesService) {}

  /**
   * Sub-recurso do atendimento, nao um recurso solto.
   *
   * O corpo NAO recebe quem avalia nem qual inscricao: os dois saem do token
   * cruzado com o atendimento da rota. Aceitar um `inscricaoId` do cliente
   * permitiria avaliar em nome de outra pessoa (RN05).
   */
  @Post('atendimentos/:atendimentoId/avaliacao')
  @ApiOperation({
    summary: 'O monitorado avalia um atendimento realizado do qual participou (RN05/RN06).',
  })
  @ApiCreatedResponse({ type: AvaliacaoRespostaDto })
  @ApiForbiddenResponse({ description: 'Nao participou deste atendimento.', type: RespostaErro })
  @ApiConflictResponse({
    description: 'Atendimento nao concluido, cancelado, sem presenca, ou ja avaliado.',
    type: RespostaErro,
  })
  avaliar(
    @Param('atendimentoId', ParseUUIDPipe) atendimentoId: string,
    @Body() dto: CriarAvaliacaoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AvaliacaoRespostaDto> {
    return this.avaliacoesService.avaliar(atendimentoId, dto, usuario);
  }

  @Get('atendimentos/:atendimentoId/avaliacoes')
  @ApiOperation({ summary: 'Avaliacoes de um atendimento, com media. Autoria nao e exposta.' })
  @ApiOkResponse({ type: ResumoAvaliacoesDto })
  listarDoAtendimento(
    @Param('atendimentoId', ParseUUIDPipe) atendimentoId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ResumoAvaliacoesDto> {
    return this.avaliacoesService.listarPorAtendimento(atendimentoId, usuario);
  }

  @Get('monitorias/:monitoriaId/monitores/:participanteId/avaliacoes')
  @ApiOperation({ summary: 'Avaliacoes recebidas por um monitor na monitoria, com media.' })
  @ApiOkResponse({ type: ResumoAvaliacoesDto })
  listarDoMonitor(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Param('participanteId', ParseUUIDPipe) participanteId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ResumoAvaliacoesDto> {
    return this.avaliacoesService.listarPorMonitor(monitoriaId, participanteId, usuario);
  }
}
