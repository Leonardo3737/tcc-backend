import {
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ExigeParticipacao } from '../../common/decorators/exige-participacao.decorator';
import { Perfis } from '../../common/decorators/perfis.decorator';
import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { ParticipacaoGuard } from '../monitorias/guards/participacao.guard';
import { AnalyticsService } from './analytics.service';
import {
  AtividadeMonitorDto,
  IndicadoresMonitoriaDto,
  IndicadoresPlataformaDto,
} from './dto/indicadores.dto';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(ParticipacaoGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Restrito a PROFESSOR.
   *
   * Sao numeros agregados, sem nome nem identificacao de ninguem — mas indicadores
   * de uso da plataforma sao informacao de gestao, nao de aluno. `apenasMinhas`
   * reduz o recorte as monitorias do proprio professor.
   */
  @Get('resumo')
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({ summary: 'Indicadores agregados da plataforma. Somente PROFESSOR.' })
  @ApiQuery({ name: 'apenasMinhas', required: false, type: Boolean })
  @ApiOkResponse({ type: IndicadoresPlataformaDto })
  resumo(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('apenasMinhas', new ParseBoolPipe({ optional: true })) apenasMinhas?: boolean,
  ): Promise<IndicadoresPlataformaDto> {
    return this.analyticsService.plataforma(usuario.id, apenasMinhas ?? false);
  }

  /** Acesso por PARTICIPACAO: o monitor tambem acompanha os numeros da monitoria dele. */
  @Get('monitorias/:monitoriaId')
  @ExigeParticipacao()
  @ApiOperation({
    summary: 'Indicadores de uma monitoria: atendimentos, participacao, avaliacoes.',
  })
  @ApiOkResponse({ type: IndicadoresMonitoriaDto })
  monitoria(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
  ): Promise<IndicadoresMonitoriaDto> {
    return this.analyticsService.monitoria(monitoriaId);
  }

  /**
   * Atividade dos monitores. Restrito ao professor responsavel: e um indicador
   * de desempenho individual, nao um placar para os colegas.
   */
  @Get('monitorias/:monitoriaId/monitores')
  @ExigeParticipacao({ professorResponsavel: 'EXIGIDO' })
  @ApiOperation({ summary: 'Atividade de cada monitor. Somente o professor responsavel.' })
  @ApiOkResponse({ type: [AtividadeMonitorDto] })
  monitores(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
  ): Promise<AtividadeMonitorDto[]> {
    return this.analyticsService.monitores(monitoriaId);
  }
}
