import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ContextoMonitoria } from '../../common/decorators/contexto-monitoria.decorator';
import { ExigeParticipacao } from '../../common/decorators/exige-participacao.decorator';
import { Perfis } from '../../common/decorators/perfis.decorator';
import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { FiltroParticipantesDto } from './dto/filtro-participantes.dto';
import { HabilitarParticipanteDto } from './dto/habilitar-participante.dto';
import { ParticipanteRespostaDto } from './dto/participante-resposta.dto';
import { ParticipacaoService, ContextoParticipacao } from './participacao.service';
import { ParticipantesService } from './participantes.service';
import { ParticipacaoGuard } from './guards/participacao.guard';

@ApiTags('Monitorias - Participantes')
@ApiBearerAuth()
@UseGuards(ParticipacaoGuard)
@Controller('monitorias/:monitoriaId')
export class ParticipantesController {
  constructor(
    private readonly participantesService: ParticipantesService,
    private readonly participacaoService: ParticipacaoService,
  ) {}

  /**
   * RN01 — habilitar um aluno como MONITOR.
   *
   * O papel vem da ROTA, nunca do corpo. Nao existe um endpoint generico
   * "criar participante com papel X": habilitar monitor e inscrever monitorado
   * sao operacoes de dominio distintas, com autorizacoes distintas.
   */
  @Post('monitores')
  @ExigeParticipacao({ professorResponsavel: 'EXIGIDO' })
  @ApiOperation({
    summary: 'Habilita um aluno como MONITOR. Somente o professor responsavel (RN01).',
  })
  @ApiCreatedResponse({ type: ParticipanteRespostaDto })
  @ApiForbiddenResponse({ description: 'Nao e o professor responsavel.', type: RespostaErro })
  @ApiConflictResponse({
    description: 'Aluno ja participa da monitoria (RN09).',
    type: RespostaErro,
  })
  habilitarMonitor(
    @Body() dto: HabilitarParticipanteDto,
    @ContextoMonitoria() contexto: ContextoParticipacao,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ParticipanteRespostaDto> {
    return this.participantesService.habilitarMonitor(contexto.monitoria, dto.alunoId, usuario);
  }

  /** O professor tambem pode inscrever um aluno diretamente como MONITORADO. */
  @Post('monitorados')
  @ExigeParticipacao({ professorResponsavel: 'EXIGIDO' })
  @ApiOperation({ summary: 'Inscreve um aluno como MONITORADO. Somente o professor responsavel.' })
  @ApiCreatedResponse({ type: ParticipanteRespostaDto })
  inscreverMonitorado(
    @Body() dto: HabilitarParticipanteDto,
    @ContextoMonitoria() contexto: ContextoParticipacao,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ParticipanteRespostaDto> {
    return this.participantesService.inscreverMonitorado(
      contexto.monitoria,
      dto.alunoId,
      usuario.id,
    );
  }

  /**
   * RN04 — auto-inscricao do aluno como MONITORADO.
   *
   * Sem @ExigeParticipacao: quem se inscreve ainda NAO participa. A autorizacao
   * aqui e ter perfil ALUNO, e o resto das regras (monitoria aberta, RN09) fica
   * no service e no banco.
   */
  @Post('inscricao')
  @Perfis(PerfilUsuario.ALUNO)
  @ApiOperation({ summary: 'Inscreve o proprio aluno autenticado como MONITORADO (RN04).' })
  @ApiCreatedResponse({ type: ParticipanteRespostaDto })
  @ApiConflictResponse({
    description: 'Ja participa desta monitoria — um aluno nao acumula papeis (RN09).',
    type: RespostaErro,
  })
  async inscreverSe(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ParticipanteRespostaDto> {
    const monitoria = await this.participacaoService.buscarMonitoriaOuFalhar(monitoriaId);
    return this.participantesService.inscreverMonitorado(monitoria, usuario.id, usuario.id);
  }

  /** Visivel a quem participa da monitoria ou ao professor responsavel. */
  @Get('participantes')
  @ExigeParticipacao()
  @ApiOperation({
    summary: 'Lista participantes. Use status=ENCERRADO para ver o historico (RN10).',
  })
  @ApiRespostaPaginada(ParticipanteRespostaDto)
  listar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Query() filtro: FiltroParticipantesDto,
  ): Promise<RespostaPaginada<ParticipanteRespostaDto>> {
    return this.participantesService.listar(monitoriaId, filtro);
  }

  /**
   * Encerra o vinculo. Nao ha DELETE nesta API por decisao de dominio (RN10):
   * o participante sai da monitoria, mas continua existindo como sujeito dos
   * atendimentos ja registrados.
   */
  @Post('participantes/:participanteId/encerrar')
  @HttpCode(HttpStatus.OK)
  @ExigeParticipacao()
  @ApiOperation({
    summary: 'Encerra a participacao (professor responsavel ou o proprio aluno). Nao apaga nada.',
  })
  @ApiOkResponse({ type: ParticipanteRespostaDto })
  @ApiConflictResponse({
    description: 'Ha atendimentos AGENDADOS vinculados a este participante.',
    type: RespostaErro,
  })
  encerrar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Param('participanteId', ParseUUIDPipe) participanteId: string,
    @ContextoMonitoria() contexto: ContextoParticipacao,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ParticipanteRespostaDto> {
    return this.participantesService.encerrarVinculo(
      monitoriaId,
      participanteId,
      usuario,
      contexto.ehProfessorResponsavel,
    );
  }
}
