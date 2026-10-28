import { CampoId } from '../../common/mcp/campo-id.decorator';

export class UsuarioMcpDto {
  @CampoId('usuarioId', 'ID do usuario.')
  usuarioId: string;
}
