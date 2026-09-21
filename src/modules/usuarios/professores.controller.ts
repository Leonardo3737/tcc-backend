import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Perfis } from '../../common/decorators/perfis.decorator';
import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { AtualizarProfessorDto } from './dto/atualizar-professor.dto';
import { UsuarioRespostaDto } from './dto/usuario-resposta.dto';
import { UsuariosService } from './usuarios.service';

@ApiTags('Professores')
@ApiBearerAuth()
@Controller('professores')
export class ProfessoresController {
  constructor(private readonly usuariosService: UsuariosService) {}

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
