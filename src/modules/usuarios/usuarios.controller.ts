import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { AlterarSenhaDto } from './dto/alterar-senha.dto';
import { AtualizarUsuarioDto } from './dto/atualizar-usuario.dto';
import { UsuarioRespostaDto } from './dto/usuario-resposta.dto';
import { UsuariosService } from './usuarios.service';

/**
 * Recursos do PROPRIO usuario autenticado.
 *
 * Todas as rotas usam o identificador `eu` em vez de receber um :id. Isso e
 * proposital: nao existe caminho para pedir "os dados do usuario X" por engano,
 * porque o ID sai do token. Elimina por construcao a classe de falha em que o
 * cliente troca o ID na URL e le ou altera dados de outra pessoa.
 */
@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Get('eu')
  @ApiOperation({ summary: 'Dados do usuario autenticado, com seus perfis atuais.' })
  @ApiOkResponse({ type: UsuarioRespostaDto })
  async buscarProprio(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<UsuarioRespostaDto> {
    const modelo = await this.usuariosService.buscarPorIdOuFalhar(usuario.id);
    return UsuarioRespostaDto.deModelo(modelo);
  }

  @Patch('eu')
  @ApiOperation({ summary: 'Atualiza os dados basicos do proprio usuario.' })
  @ApiOkResponse({ type: UsuarioRespostaDto })
  async atualizarProprio(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: AtualizarUsuarioDto,
  ): Promise<UsuarioRespostaDto> {
    if (dto.nome === undefined) {
      return this.buscarProprio(usuario);
    }

    return this.usuariosService.atualizarNome(usuario.id, dto.nome);
  }

  @Patch('eu/senha')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Altera a senha do proprio usuario.' })
  @ApiNoContentResponse({ description: 'Senha alterada.' })
  @ApiUnauthorizedResponse({ description: 'Senha atual incorreta.', type: RespostaErro })
  alterarSenha(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: AlterarSenhaDto,
  ): Promise<void> {
    return this.usuariosService.alterarSenha(usuario.id, dto.senhaAtual, dto.novaSenha);
  }
}
