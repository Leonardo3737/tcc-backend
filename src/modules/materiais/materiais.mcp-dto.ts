import { CampoId } from '../../common/mcp/campo-id.decorator';
import { AtualizarMaterialDto } from './dto/atualizar-material.dto';
import { CriarMaterialDto } from './dto/criar-material.dto';
import { FiltroMateriaisDto } from './dto/filtro-materiais.dto';

export class PublicarMaterialMcpDto extends CriarMaterialDto {
  @CampoId('monitoriaId', 'ID da monitoria em que o material sera publicado.')
  monitoriaId: string;
}

export class ListarMateriaisMcpDto extends FiltroMateriaisDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;
}

export class MaterialMcpDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;

  @CampoId('materialId', 'ID do material.')
  materialId: string;
}

export class AtualizarMaterialMcpDto extends AtualizarMaterialDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;

  @CampoId('materialId', 'ID do material a alterar.')
  materialId: string;
}
