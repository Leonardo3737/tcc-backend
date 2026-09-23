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
import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { AtualizarProfessorDto } from './dto/atualizar-professor.dto';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { CriarProfessorPeloProfessorDto } from './dto/criar-usuario-pelo-professor.dto';
import { UsuarioRespostaDto } from './dto/usuario-resposta.dto';
import { UsuariosService } from './usuarios.service';

@ApiTags('Professores')
@ApiBearerAuth()
@Controller('professores')
export class ProfessoresController {
  constructor(private readonly usuariosService: UsuariosService) {}

  /**
   * Criacao administrativa de professor — POR outro professor.
   *
   * Consequencia de nao existir ADMIN: o conjunto de professores se expande por
   * decisao de quem ja esta dentro, sem nivel acima para autorizar. Nao ha
   * hierarquia contendo isso; o que existe e a trilha — `criadoPorUsuarioId`
   * registra quem criou cada conta.
   *
   * Nao exige CODIGO_CADASTRO_PROFESSOR: aquele codigo protege o auto-cadastro
   * PUBLICO, onde ele e a unica barreira. Aqui a barreira e estar autenticado
   * como professor, que e mais forte.
   */
  @Post()
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Cadastra outro professor. Somente PROFESSOR.',
    description:
      'Nao exige CODIGO_CADASTRO_PROFESSOR — a autorizacao e ja ser professor. ' +
      'A senha informada e PROVISORIA: oriente a pessoa a troca-la em ' +
      'PATCH /api/usuarios/eu/senha. A autoria fica registrada em criadoPorUsuarioId.',
  })
  @ApiCreatedResponse({ type: UsuarioRespostaDto })
  @ApiConflictResponse({
    description: 'E-mail ou identificacao funcional ja cadastrados.',
    type: RespostaErro,
  })
  criar(
    @Body() dto: CriarProfessorPeloProfessorDto,
    @UsuarioAtual() professor: UsuarioAutenticado,
  ): Promise<UsuarioRespostaDto> {
    return this.usuariosService.criarProfessorComoProfessor(dto, professor.id);
  }

  /**
   * Aberto a qualquer usuario autenticado — inclusive alunos.
   *
   * Assimetria proposital em relacao a /alunos: na fase 2 o aluno precisa
   * descobrir quais professores oferecem monitoria para se inscrever. Alem
   * disso, nome e departamento de docente sao informacao publica na instituicao.
   */
  @Get()
  @ApiOperation({ summary: 'Lista professores cadastrados na plataforma.' })
  @ApiRespostaPaginada(UsuarioRespostaDto)
  listar(@Query() paginacao: PaginacaoDto): Promise<RespostaPaginada<UsuarioRespostaDto>> {
    return this.usuariosService.listarProfessores(paginacao);
  }

  @Patch('eu')
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({ summary: 'Atualiza os dados do proprio professor.' })
  @ApiOkResponse({ type: UsuarioRespostaDto })
  atualizarProprio(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: AtualizarProfessorDto,
  ): Promise<UsuarioRespostaDto> {
    return this.usuariosService.atualizarDadosProfessor(usuario.id, dto);
  }

  @Get(':usuarioId')
  @ApiOperation({ summary: 'Detalha um professor.' })
  @ApiOkResponse({ type: UsuarioRespostaDto })
  buscar(@Param('usuarioId', ParseUUIDPipe) usuarioId: string): Promise<UsuarioRespostaDto> {
    return this.usuariosService.buscarProfessorOuFalhar(usuarioId);
  }
}
