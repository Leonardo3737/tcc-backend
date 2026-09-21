import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Perfis } from '../../common/decorators/perfis.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { DisciplinasService } from './disciplinas.service';
import { AtualizarDisciplinaDto } from './dto/atualizar-disciplina.dto';
import { CriarDisciplinaDto } from './dto/criar-disciplina.dto';
import { DisciplinaRespostaDto } from './dto/disciplina-resposta.dto';
import { FiltroDisciplinasDto } from './dto/filtro-disciplinas.dto';

@ApiTags('Disciplinas')
@ApiBearerAuth()
@Controller('disciplinas')
export class DisciplinasController {
  constructor(private readonly disciplinasService: DisciplinasService) {}

  /**
   * Restrito a PROFESSOR: o catalogo alimenta a criacao de monitorias, e deixar
   * qualquer aluno cadastrar disciplina encheria a base de duplicatas.
   */
  @Post()
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({ summary: 'Cadastra uma disciplina no catalogo. Somente PROFESSOR.' })
  @ApiCreatedResponse({ type: DisciplinaRespostaDto })
  @ApiConflictResponse({ description: 'Codigo ja cadastrado.', type: RespostaErro })
  criar(@Body() dto: CriarDisciplinaDto): Promise<DisciplinaRespostaDto> {
    return this.disciplinasService.criar(dto);
  }

  /** Leitura liberada a qualquer autenticado: o aluno precisa navegar o catalogo. */
  @Get()
  @ApiOperation({ summary: 'Lista disciplinas do catalogo.' })
  @ApiRespostaPaginada(DisciplinaRespostaDto)
  listar(@Query() filtro: FiltroDisciplinasDto): Promise<RespostaPaginada<DisciplinaRespostaDto>> {
    return this.disciplinasService.listar(filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha uma disciplina.' })
  @ApiOkResponse({ type: DisciplinaRespostaDto })
  detalhar(@Param('id', ParseUUIDPipe) id: string): Promise<DisciplinaRespostaDto> {
    return this.disciplinasService.detalhar(id);
  }

  @Patch(':id')
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({ summary: 'Renomeia ou (des)ativa uma disciplina. Somente PROFESSOR.' })
  @ApiOkResponse({ type: DisciplinaRespostaDto })
  atualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarDisciplinaDto,
  ): Promise<DisciplinaRespostaDto> {
    return this.disciplinasService.atualizar(id, dto);
  }
}
