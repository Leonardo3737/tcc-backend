import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { Perfis } from '../../common/decorators/perfis.decorator';
import { Publico } from '../../common/decorators/publico.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { CursosService } from './cursos.service';
import { AtualizarCursoDto } from './dto/atualizar-curso.dto';
import { CriarCursoDto } from './dto/criar-curso.dto';
import { CursoRespostaDto } from './dto/curso-resposta.dto';
import { FiltroCursosDto } from './dto/filtro-cursos.dto';

@ApiTags('Cursos')
@ApiBearerAuth()
@Controller('cursos')
export class CursosController {
  constructor(private readonly cursosService: CursosService) {}

  /**
   * Restrito a PROFESSOR: o catalogo alimenta a criacao de monitorias, e deixar
   * qualquer aluno cadastrar disciplina encheria a base de duplicatas.
   */
  @Post()
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Cadastra um curso no catalogo. Somente PROFESSOR.',
    description:
      'Envie apenas o nome: o codigo e gerado pelo servidor a partir dele, no formato ' +
      'PREFIXO + sequencia ("Engenharia de Software" -> ENG001). Mandar `codigo` devolve 400. ' +
      'O codigo e imutavel depois de criado.',
  })
  @ApiCreatedResponse({ type: CursoRespostaDto })
  @ApiConflictResponse({
    description: 'Nao foi possivel gerar um codigo livre apos as tentativas.',
    type: RespostaErro,
  })
  criar(@Body() dto: CriarCursoDto): Promise<CursoRespostaDto> {
    return this.cursosService.criar(dto);
  }

  /**
   * PUBLICA desde a feature de editais.
   *
   * O formulario de inscricao em edital nao exige conta — o candidato ainda nao
   * tem uma — e precisa oferecer a lista de cursos para escolher. A
   * alternativa seria duplicar esta consulta em uma rota publica paralela, que e
   * exatamente o endpoint redundante que o escopo pede para evitar.
   *
   * O que se abre aqui e CATALOGO: codigo, nome e situacao de um curso. Nenhum dado pessoal passa por
   * esta rota. A escrita continua restrita a PROFESSOR.
   */
  @Publico()
  @Get()
  @ApiOperation({ summary: 'Lista cursos do catalogo. PUBLICO (alimenta o formulario de edital).' })
  @ApiRespostaPaginada(CursoRespostaDto)
  listar(@Query() filtro: FiltroCursosDto): Promise<RespostaPaginada<CursoRespostaDto>> {
    return this.cursosService.listar(filtro);
  }

  /** Publica pela mesma razao de `listar`. */
  @Publico()
  @Get(':id')
  @ApiOperation({ summary: 'Detalha um curso. PUBLICO.' })
  @ApiOkResponse({ type: CursoRespostaDto })
  detalhar(@Param('id', ParseUUIDPipe) id: string): Promise<CursoRespostaDto> {
    return this.cursosService.detalhar(id);
  }

  @Patch(':id')
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({ summary: 'Renomeia ou (des)ativa um curso. Somente PROFESSOR.' })
  @ApiOkResponse({ type: CursoRespostaDto })
  atualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarCursoDto,
  ): Promise<CursoRespostaDto> {
    return this.cursosService.atualizar(id, dto);
  }
}
