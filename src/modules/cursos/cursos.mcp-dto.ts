import { CampoId } from '../../common/mcp/campo-id.decorator';
import { AtualizarCursoDto } from './dto/atualizar-curso.dto';

export class CursoMcpDto {
  @CampoId('id', 'ID do curso.')
  id: string;
}

export class AtualizarCursoMcpDto extends AtualizarCursoDto {
  @CampoId('id', 'ID do curso a atualizar.')
  id: string;
}
