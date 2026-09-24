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
import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { ParticipacaoGuard } from '../monitorias/guards/participacao.guard';
import { ContextoParticipacao } from '../monitorias/participacao.service';
import { AtualizarMaterialDto } from './dto/atualizar-material.dto';
import { FiltroMateriaisDto } from './dto/filtro-materiais.dto';
import { CriarMaterialDto } from './dto/criar-material.dto';
import { MaterialRespostaDto } from './dto/material-resposta.dto';
import { MateriaisService } from './materiais.service';

/**
 * Materiais vivem sob a MONITORIA, nao sob a disciplina.
 *
 * E o que torna RN07 e RN08 verificaveis: quem pode ver e quem pode publicar sao
 * definidos pela participacao, e a participacao so existe no contexto de uma
 * monitoria. Uma rota /disciplinas/:id/materiais nao teria como responder "voce
 * pode ver isto?".
 */
@ApiTags('Monitorias - Materiais')
@ApiBearerAuth()
@UseGuards(ParticipacaoGuard)
@Controller('monitorias/:monitoriaId/materiais')
export class MateriaisController {
  constructor(private readonly materiaisService: MateriaisService) {}

  /** RN08: professor responsavel ou MONITOR habilitado. MONITORADO nao publica. */
  @Post()
  @ExigeParticipacao({ papeis: [PapelMonitoria.MONITOR], professorResponsavel: 'PERMITIDO' })
  @ApiOperation({ summary: 'Publica um material na monitoria (RN08).' })
  @ApiCreatedResponse({ type: MaterialRespostaDto })
  @ApiForbiddenResponse({ description: 'Monitorado nao publica material.', type: RespostaErro })
  publicar(
    @Body() dto: CriarMaterialDto,
    @ContextoMonitoria() contexto: ContextoParticipacao,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MaterialRespostaDto> {
    return this.materiaisService.publicar(contexto, dto, usuario);
  }

  /**
   * RN07: somente participantes autorizados acessam o acervo.
   *
   * Todos os parametros de query vem de um unico DTO. Ler um deles com
   * `@Query('chave')` a parte, ao lado de um `@Query() dto`, fazia a requisicao
   * inteira ser recusada com 400: o ValidationPipe valida o objeto de query
   * completo contra o DTO e `forbidNonWhitelisted` rejeita o que nao estiver
   * declarado nele.
   */
  @Get()
  @ExigeParticipacao()
  @ApiOperation({ summary: 'Lista os materiais da monitoria (RN07).' })
  @ApiRespostaPaginada(MaterialRespostaDto)
  listar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Query() filtro: FiltroMateriaisDto,
  ): Promise<RespostaPaginada<MaterialRespostaDto>> {
    return this.materiaisService.listar(monitoriaId, filtro);
  }

  @Get(':materialId')
  @ExigeParticipacao()
  @ApiOperation({ summary: 'Detalha um material da monitoria.' })
  @ApiOkResponse({ type: MaterialRespostaDto })
  detalhar(
    @Param('monitoriaId', ParseUUIDPipe) monitoriaId: string,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ): Promise<MaterialRespostaDto> {
    return this.materiaisService.detalhar(monitoriaId, materialId);
  }

  @Patch(':materialId')
  @ExigeParticipacao({ papeis: [PapelMonitoria.MONITOR], professorResponsavel: 'PERMITIDO' })
  @ApiOperation({ summary: 'Edita um material. Somente o autor ou o professor responsavel.' })
  @ApiOkResponse({ type: MaterialRespostaDto })
  atualizar(
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @Body() dto: AtualizarMaterialDto,
    @ContextoMonitoria() contexto: ContextoParticipacao,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MaterialRespostaDto> {
    return this.materiaisService.atualizar(contexto, materialId, dto, usuario);
  }

  /**
   * Remocao logica. Como em todo o resto da API, nao ha DELETE: o material sai
   * das listagens mas continua no banco, com data e autor da remocao (RN10).
   */
  @Post(':materialId/remover')
  @HttpCode(HttpStatus.OK)
  @ExigeParticipacao({ papeis: [PapelMonitoria.MONITOR], professorResponsavel: 'PERMITIDO' })
  @ApiOperation({ summary: 'Remove um material do acervo sem apagar o registro (RN10).' })
  @ApiOkResponse({ type: MaterialRespostaDto })
  @ApiConflictResponse({ description: 'Material ja removido.', type: RespostaErro })
  remover(
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @ContextoMonitoria() contexto: ContextoParticipacao,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<MaterialRespostaDto> {
    return this.materiaisService.remover(contexto, materialId, usuario);
  }
}
