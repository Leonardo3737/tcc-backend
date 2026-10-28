import { CampoId } from '../../common/mcp/campo-id.decorator';
import { AtualizarMonitoriaDto } from './dto/atualizar-monitoria.dto';
import { CancelarMonitoriaDto } from './dto/cancelar-monitoria.dto';
import { FiltroParticipantesDto } from './dto/filtro-participantes.dto';
import { HabilitarParticipanteDto } from './dto/habilitar-participante.dto';

/**
 * DTOs de argumento das ferramentas MCP de monitoria e participantes.
 *
 * Uma ferramenta MCP recebe UM objeto de argumentos; a rota REST equivalente
 * recebe `:monitoriaId` no caminho e o corpo separado. Em vez de reescrever os
 * DTOs, cada classe aqui ESTENDE a do REST e acrescenta os identificadores que
 * eram parametro de rota — assim as regras de validacao continuam sendo as
 * mesmas, em um lugar so, e um campo novo no DTO do REST aparece na ferramenta
 * sem ninguem lembrar de copia-lo.
 */

export class MonitoriaMcpDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;
}

export class AtualizarMonitoriaMcpDto extends AtualizarMonitoriaDto {
  @CampoId('monitoriaId', 'ID da monitoria a atualizar.')
  monitoriaId: string;
}

export class CancelarMonitoriaMcpDto extends CancelarMonitoriaDto {
  @CampoId('monitoriaId', 'ID da monitoria a cancelar.')
  monitoriaId: string;
}

export class HabilitarParticipanteMcpDto extends HabilitarParticipanteDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;
}

export class ListarParticipantesMcpDto extends FiltroParticipantesDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;
}

export class ParticipanteMcpDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;

  @CampoId('participanteId', 'ID do vinculo do participante na monitoria.')
  participanteId: string;
}
