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
import { Publico } from '../../common/decorators/publico.decorator';
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
  @ApiOperation({
    summary: 'Cadastra uma disciplina no catalogo. Somente PROFESSOR.',
    description:
      'Envie apenas o nome: o codigo e gerado pelo servidor a partir dele, no formato ' +
      'PREFIXO + sequencia ("Calculo I" -> CAL001). Mandar `codigo` devolve 400. ' +
      'O codigo e imutavel depois de criado.',
  })
  @ApiCreatedResponse({ type: DisciplinaRespostaDto })
  @ApiConflictResponse({
    description: 'Nao foi possivel gerar um codigo livre apos as tentativas.',
    type: RespostaErro,
  })
  criar(@Body() dto: CriarDisciplinaDto): Promise<DisciplinaRespostaDto> {
    return this.disciplinasService.criar(dto);
  }

  /**
   * PUBLICA desde a feature de editais.
   *
   * O formulario de inscricao em edital nao exige conta — o candidato ainda nao
   * tem uma — e precisa oferecer a lista de disciplinas para escolher. A
   * alternativa seria duplicar esta consulta em uma rota publica paralela, que e
   * exatamente o endpoint redundante que o escopo pede para evitar.
   *
   * O que se abre aqui e CATALOGO: codigo, nome, situacao e os cursos que oferecem a disciplina. Nenhum dado pessoal passa por
   * esta rota. A escrita continua restrita a PROFESSOR.
   */
  @Publico()
  @Get()
  @ApiOperation({
    summary: 'Lista disciplinas do catalogo. PUBLICO (alimenta o formulario de edital).',
    description:
      'Com `cursoId`, devolve so as disciplinas oferecidas por aquele curso — e assim que o ' +
      'formulario publico de inscricao monta a segunda lista depois de escolhido o curso.',
  })
  @ApiRespostaPaginada(DisciplinaRespostaDto)
  listar(@Query() filtro: FiltroDisciplinasDto): Promise<RespostaPaginada<DisciplinaRespostaDto>> {
    return this.disciplinasService.listar(filtro);
  }

  /** Publica pela mesma razao de `listar`. */
  @Publico()
  @Get(':id')
  @ApiOperation({ summary: 'Detalha uma disciplina. PUBLICO.' })
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
