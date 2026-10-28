import { UseFilters, UsePipes } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool } from '@rekog/mcp-nest';

import { ESCRITA, LEITURA } from '../../common/mcp/anotacoes';
import { SEM_ARGUMENTOS, dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { AtualizarUsuarioDto } from './dto/atualizar-usuario.dto';
import { UsuarioRespostaDto } from './dto/usuario-resposta.dto';
import { UsuariosService } from './usuarios.service';

/**
 * Ferramentas MCP da propria conta.
 *
 * `PATCH /usuarios/eu/senha` NAO tem ferramenta equivalente, de proposito: o
 * corpo daquela rota carrega a senha atual e a nova em texto. Argumento de
 * ferramenta MCP passa pelo cliente e pelo modelo antes de chegar aqui, e
 * trocar senha por esse caminho colocaria a credencial em um lugar onde ela nao
 * precisa estar. Troca de senha continua pelo REST, pelo frontend.
 */
@McpController('usuarios')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class UsuariosMcpController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Tool({
    name: 'obter_meu_usuario',
    description: 'Dados do usuario autenticado, com os perfis que ele tem agora.',
    parameters: SEM_ARGUMENTOS,
    annotations: LEITURA,
  })
  async obterProprio(@Ctx() ctx: McpContext): Promise<UsuarioRespostaDto> {
    const modelo = await this.usuariosService.buscarPorIdOuFalhar(usuarioMcp(ctx).id);
    return UsuarioRespostaDto.deModelo(modelo);
  }

  @Tool({
    name: 'atualizar_meu_usuario',
    description:
      'Altera os dados basicos da propria conta. Somente o nome e editavel: o e-mail e credencial de login.',
    parameters: dtoParaJsonSchema(AtualizarUsuarioDto),
    annotations: { ...ESCRITA, idempotentHint: true },
  })
  async atualizarProprio(
    @Payload() dto: AtualizarUsuarioDto,
    @Ctx() ctx: McpContext,
  ): Promise<UsuarioRespostaDto> {
    if (dto.nome === undefined) {
      return this.obterProprio(ctx);
    }

    return this.usuariosService.atualizarNome(usuarioMcp(ctx).id, dto.nome);
  }
}
