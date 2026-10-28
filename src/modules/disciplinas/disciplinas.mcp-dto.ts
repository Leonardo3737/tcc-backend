import { CampoId } from '../../common/mcp/campo-id.decorator';
import { AtualizarDisciplinaDto } from './dto/atualizar-disciplina.dto';

export class DisciplinaMcpDto {
  @CampoId('id', 'ID da disciplina.')
  id: string;
}

export class AtualizarDisciplinaMcpDto extends AtualizarDisciplinaDto {
  @CampoId('id', 'ID da disciplina a atualizar.')
  id: string;
}
