import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Perfis } from '../../common/decorators/perfis.decorator';
import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { FiltroAlunosDto } from './dto/filtro-alunos.dto';
import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { AtualizarAlunoDto } from './dto/atualizar-aluno.dto';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { CriarAlunoPeloProfessorDto } from './dto/criar-usuario-pelo-professor.dto';
import { UsuarioRespostaDto } from './dto/usuario-resposta.dto';
import { UsuariosService } from './usuarios.service';

@ApiTags('Alunos')
@ApiBearerAuth()
@Controller('alunos')
export class AlunosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  /**
   * UNICO caminho de criacao de aluno.
   *
   * Nao ha auto-cadastro: a antiga POST /api/auth/registro/aluno foi removida.
   * Enquanto nao existe perfil ADMIN, sao os professores que administram os
   * usuarios da plataforma, e `criadoPorUsuarioId` registra quem criou cada
   * conta — a trilha e o que substitui a hierarquia ausente.
   *
   * O professor NAO escolhe a senha e nao chega a ve-la: ela e gerada pelo
   * servidor e enviada ao e-mail informado. Se o envio falhar, a criacao e
   * desfeita e a resposta e 503 — uma conta cuja senha nao chegou a ninguem
   * seria inutilizavel.
   */
  @Post()
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Cadastra um aluno. Somente PROFESSOR.',
    description:
      'Unico caminho de criacao de aluno — nao existe auto-cadastro. NAO envie senha: ' +
      'o servidor gera uma aleatoria e a envia ao e-mail do aluno. Se o e-mail nao ' +
      'puder ser entregue, a conta nao e criada (503).',
  })
  @ApiCreatedResponse({ type: UsuarioRespostaDto })
  @ApiConflictResponse({ description: 'E-mail ou matricula ja cadastrados.', type: RespostaErro })
  @ApiServiceUnavailableResponse({
    description: 'Falha ao enviar a senha por e-mail. A conta nao foi criada.',
    type: RespostaErro,
  })
  criar(
    @Body() dto: CriarAlunoPeloProfessorDto,
    @UsuarioAtual() professor: UsuarioAutenticado,
  ): Promise<UsuarioRespostaDto> {
    // O autor vem do token, nunca do corpo: e o que torna a trilha confiavel.
    return this.usuariosService.criarAlunoComoProfessor(dto, professor.id);
  }

  /**
   * Restrito a PROFESSOR.
   *
   * Justificativa de dominio: na fase 2 e o professor quem habilita alunos como
   * monitores (RN01), e para isso precisa localiza-los. Nao ha motivo para um
   * aluno conseguir listar a base inteira de colegas.
   */
  @Get()
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Lista alunos cadastrados na plataforma. Somente PROFESSOR.',
    description:
      'Suporta busca parcial por nome, matricula ou e-mail. Use ' +
      'semVinculoAtivoNaMonitoria ao montar a lista de candidatos a monitor, ' +
      'para nao oferecer quem ja participa da monitoria (RN09).',
  })
  @ApiRespostaPaginada(UsuarioRespostaDto)
  listar(@Query() filtro: FiltroAlunosDto): Promise<RespostaPaginada<UsuarioRespostaDto>> {
    return this.usuariosService.listarAlunos(filtro);
  }

  @Patch('eu')
  @Perfis(PerfilUsuario.ALUNO)
  @ApiOperation({ summary: 'Atualiza os dados academicos do proprio aluno.' })
  @ApiOkResponse({ type: UsuarioRespostaDto })
  atualizarProprio(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: AtualizarAlunoDto,
  ): Promise<UsuarioRespostaDto> {
    return this.usuariosService.atualizarDadosAluno(usuario.id, dto);
  }

  /**
   * Visivel para PROFESSOR ou para o proprio aluno.
   *
   * A checagem e feita aqui, no service layer da requisicao, e nao por um guard
   * declarativo, porque depende de comparar o :usuarioId da rota com o ID do
   * token — decisao que o PerfilGuard, que so conhece perfis, nao tem como tomar.
   */
  @Get(':usuarioId')
  @ApiOperation({ summary: 'Detalha um aluno. Acessivel ao proprio aluno ou a um PROFESSOR.' })
  @ApiOkResponse({ type: UsuarioRespostaDto })
  buscar(
    @Param('usuarioId', ParseUUIDPipe) usuarioId: string,
    @UsuarioAtual() solicitante: UsuarioAutenticado,
  ): Promise<UsuarioRespostaDto> {
    const ehProfessor = solicitante.perfis.includes(PerfilUsuario.PROFESSOR);

    if (!ehProfessor && solicitante.id !== usuarioId) {
      throw new ForbiddenException('Voce so pode consultar os seus proprios dados.');
    }

    return this.usuariosService.buscarAlunoOuFalhar(usuarioId);
  }
}
