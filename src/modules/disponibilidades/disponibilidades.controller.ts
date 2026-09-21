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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ContextoMonitoria } from '../../common/decorators/contexto-monitoria.decorator';
import { ExigeParticipacao } from '../../common/decorators/exige-participacao.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { ContextoParticipacao } from '../monitorias/participacao.service';
import { ParticipacaoGuard } from '../monitorias/guards/participacao.guard';
import { DisponibilidadesService } from './disponibilidades.service';
import { CriarDisponibilidadeDto } from './dto/criar-disponibilidade.dto';
import { DisponibilidadeRespostaDto } from './dto/disponibilidade-resposta.dto';
import { FiltroDisponibilidadesDto } from './dto/filtro-disponibilidades.dto';

@ApiTags('Monitorias - Disponibilidades')
@ApiBearerAuth()
@UseGuards(ParticipacaoGuard)
@Controller('monitorias/:monitoriaId/disponibilidades')
export class DisponibilidadesController {
  constructor(private readonly disponibilidadesService: DisponibilidadesService) {}

  /**
   * `professorResponsavel: 'NEGADO'` e proposital.
   *
   * O professor administra a monitoria, mas nao TEM agenda de monitor — a
   * disponibilidade pertence ao vinculo de quem vai atender. Deixar o professor
   * criar disponibilidade exigiria inventar de quem ela seria.
   */
  @Post()
  @ExigeParticipacao({ papeis: [PapelMonitoria.MONITOR], professorResponsavel: 'NEGADO' })
  @ApiOperation({ summary: 'O monitor declara uma faixa semanal de disponibilidade.' })
  @ApiCreatedResponse({ type: DisponibilidadeRespostaDto })
  @ApiConflictResponse({
    description: 'Faixa se sobrepoe a outra ja cadastrada.',
    type: RespostaErro,
  })
  criar(
    @Body() dto: CriarDisponibilidadeDto,
    @ContextoMonitoria() contexto: ContextoParticipacao,
  ): Promise<DisponibilidadeRespostaDto> {
    return this.disponibilidadesService.criar(contexto.monitoria, contexto.participacao!, dto);
  }

  /**
   * Leitura aberta a qualquer usuario autenticado.
   *
   * Exigir participacao aqui invertia o fluxo de descoberta: o aluno precisava
   * entrar na monitoria para so entao descobrir se o horario servia para ele.
   * RN07 restringe MATERIAIS, nao disponibilidades — e horario de atendimento de
   * monitor e o tipo de informacao que a instituicao afixa em mural. Nao ha
   * regra de dominio sendo relaxada, apenas uma restricao sem lastro sendo
   * removida.
   */
  @Get()
  @ApiOperation({
    summary: 'Lista as disponibilidades dos monitores da monitoria.',
    description:
      'Leitura aberta a qualquer usuario autenticado, para que o aluno possa avaliar ' +
      'a compatibilidade de horario ANTES de se inscrever na monitoria.',
  })
  @ApiOkResponse({ type: [DisponibilidadeRespostaDto] })
  listar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Query() filtro: FiltroDisponibilidadesDto,
  ): Promise<DisponibilidadeRespostaDto[]> {
    return this.disponibilidadesService.listar(monitoriaId, filtro);
  }

  @Post(':disponibilidadeId/desativar')
  @HttpCode(HttpStatus.OK)
  @ExigeParticipacao({ papeis: [PapelMonitoria.MONITOR], professorResponsavel: 'NEGADO' })
  @ApiOperation({ summary: 'Desativa uma faixa. Nao apaga: atendimentos passados a referenciam.' })
  @ApiOkResponse({ type: DisponibilidadeRespostaDto })
  desativar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Param('disponibilidadeId', ParseUUIDPipe) disponibilidadeId: string,
    @ContextoMonitoria() contexto: ContextoParticipacao,
  ): Promise<DisponibilidadeRespostaDto> {
    return this.disponibilidadesService.desativar(
      monitoriaId,
      disponibilidadeId,
      contexto.participacao!,
    );
  }
}
