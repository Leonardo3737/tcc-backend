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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Perfis } from '../../common/decorators/perfis.decorator';
import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { AtualizarMonitoriaDto } from './dto/atualizar-monitoria.dto';
import { CancelarMonitoriaDto } from './dto/cancelar-monitoria.dto';
import { CriarMonitoriaDto } from './dto/criar-monitoria.dto';
import { FiltroMinhasMonitoriasDto } from './dto/filtro-minhas-monitorias.dto';
import { FiltroMonitoriasDto } from './dto/filtro-monitorias.dto';
import { MonitoriaRespostaDto } from './dto/monitoria-resposta.dto';
import { MonitoriasService } from './monitorias.service';

@ApiTags('Monitorias')
@ApiBearerAuth()
@Controller('monitorias')
export class MonitoriasController {
  constructor(private readonly monitoriasService: MonitoriasService) {}

  /**
   * O `professorId` e injetado AQUI, com o id do token.
   *
   * E este ponto que sustenta "por esta rota, a monitoria e sempre de quem a
   * criou". O campo existe no DTO sem decorator de validacao, entao o cliente
   * nao consegue manda-lo — tentar devolve 400. Mover a decisao para o
   * controller foi o que permitiu a aprovacao de candidatura criar a monitoria
   * no nome do professor que o candidato indicou, sem afrouxar esta rota.
   */
  @Post()
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Cria uma monitoria. O professor responsavel e sempre o autenticado.',
    description:
      'Nao aceita `professorId`: o responsavel vem do token. Mandar o campo devolve 400.',
  })
  @ApiCreatedResponse({ type: MonitoriaRespostaDto })
  @ApiConflictResponse({
    description: 'Ja existe monitoria desta disciplina para este professor no periodo.',
    type: RespostaErro,
  })
  criar(
    @Body() dto: CriarMonitoriaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.criar({ ...dto, professorId: usuario.id });
  }

  /** Catalogo publico de ofertas: o aluno precisa descobrir onde se inscrever. */
  @Get()
  @ApiOperation({ summary: 'Lista monitorias com filtros de disciplina, periodo e status.' })
  @ApiRespostaPaginada(MonitoriaRespostaDto)
  listar(@Query() filtro: FiltroMonitoriasDto): Promise<RespostaPaginada<MonitoriaRespostaDto>> {
    return this.monitoriasService.listar(filtro);
  }

  /**
   * Monitorias do usuario autenticado, cada uma anotada com o papel dele naquele
   * contexto. E a rota que evidencia o modelo: a mesma pessoa aparece como
   * MONITOR em uma monitoria e MONITORADO em outra.
   *
   * Declarada antes de :monitoriaId para que "minhas" nao seja lida como UUID.
   */
  @Get('minhas')
  @ApiOperation({
    summary: 'Monitorias em que o usuario participa, com o papel em cada uma.',
    description:
      'Paginada. Por padrao devolve apenas monitorias PLANEJADA e ATIVA (visao de ' +
      'dashboard); para consultar o historico informe os status desejados, ex.: ' +
      '?status=ENCERRADA&status=CANCELADA',
  })
  @ApiRespostaPaginada(MonitoriaRespostaDto)
  minhas(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query() filtro: FiltroMinhasMonitoriasDto,
  ): Promise<RespostaPaginada<MonitoriaRespostaDto>> {
    return this.monitoriasService.minhas(usuario, filtro);
  }

  @Get(':monitoriaId')
  @ApiOperation({ summary: 'Detalha uma monitoria.' })
  @ApiOkResponse({ type: MonitoriaRespostaDto })
  detalhar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.detalhar(monitoriaId, usuario);
  }

  @Patch(':monitoriaId')
  @ApiOperation({ summary: 'Atualiza descricao e vigencia. Somente o professor responsavel.' })
  @ApiOkResponse({ type: MonitoriaRespostaDto })
  @ApiForbiddenResponse({ description: 'Nao e o professor responsavel.', type: RespostaErro })
  atualizar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Body() dto: AtualizarMonitoriaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.atualizar(monitoriaId, dto, usuario);
  }

  /**
   * As tres rotas abaixo sao TRANSICOES DE ESTADO, nao um PATCH em `status`.
   *
   * Expor `status` como campo editavel permitiria pular etapas do ciclo de vida
   * (PLANEJADA -> ENCERRADA) e nao teria onde exigir o motivo do cancelamento.
   * Cada transicao tem pre-condicoes proprias, entao cada uma e uma operacao.
   */
  @Post(':monitoriaId/ativar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PLANEJADA -> ATIVA. A partir daqui a monitoria aceita atendimentos.' })
  @ApiOkResponse({ type: MonitoriaRespostaDto })
  @ApiConflictResponse({ description: 'Transicao invalida.', type: RespostaErro })
  ativar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.ativar(monitoriaId, usuario);
  }

  @Post(':monitoriaId/encerrar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ATIVA -> ENCERRADA. Encerra os vinculos ativos preservando todo o historico.',
  })
  @ApiOkResponse({ type: MonitoriaRespostaDto })
  @ApiConflictResponse({ description: 'Ha atendimentos AGENDADOS pendentes.', type: RespostaErro })
  encerrar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.encerrar(monitoriaId, usuario);
  }

  @Post(':monitoriaId/cancelar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PLANEJADA|ATIVA -> CANCELADA. Exige motivo.' })
  @ApiOkResponse({ type: MonitoriaRespostaDto })
  cancelar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Body() dto: CancelarMonitoriaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MonitoriaRespostaDto> {
    return this.monitoriasService.cancelar(monitoriaId, usuario, dto.motivo);
  }
}
