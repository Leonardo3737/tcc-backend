import { CampoId } from '../../common/mcp/campo-id.decorator';
import { CriarDisponibilidadeDto } from './dto/criar-disponibilidade.dto';
import { FiltroDisponibilidadesDto } from './dto/filtro-disponibilidades.dto';

export class CriarDisponibilidadeMcpDto extends CriarDisponibilidadeDto {
  @CampoId('monitoriaId', 'ID da monitoria em que o monitor declara a faixa.')
  monitoriaId: string;
}

export class ListarDisponibilidadesMcpDto extends FiltroDisponibilidadesDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;
}

export class DesativarDisponibilidadeMcpDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;

  @CampoId('disponibilidadeId', 'ID da faixa de disponibilidade a desativar.')
  disponibilidadeId: string;
}
