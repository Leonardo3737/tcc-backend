import { CampoId } from '../../common/mcp/campo-id.decorator';
import { AgendarAtendimentoDto } from './dto/agendar-atendimento.dto';
import { AgendarAtendimentosEmLoteDto } from './dto/agendar-em-lote.dto';
import { AtualizarAtendimentoDto } from './dto/atualizar-atendimento.dto';
import { CancelarAtendimentoDto } from './dto/cancelar-atendimento.dto';
import { FiltroAtendimentosDto } from './dto/filtro-atendimentos.dto';
import { FiltroHorariosLivresDto } from './dto/filtro-horarios-livres.dto';
import { ReagendarAtendimentoDto } from './dto/reagendar-atendimento.dto';
import { RealizarAtendimentoDto } from './dto/realizar-atendimento.dto';

/* --- escopo monitoria --- */

export class AgendarAtendimentoMcpDto extends AgendarAtendimentoDto {
  @CampoId('monitoriaId', 'ID da monitoria em que a sessao sera agendada.')
  monitoriaId: string;
}

export class AgendarEmLoteMcpDto extends AgendarAtendimentosEmLoteDto {
  @CampoId('monitoriaId', 'ID da monitoria em que a serie sera agendada.')
  monitoriaId: string;
}

export class HorariosLivresMcpDto extends FiltroHorariosLivresDto {
  @CampoId('monitoriaId', 'ID da monitoria cuja agenda sera consultada.')
  monitoriaId: string;
}

export class ListarAtendimentosDaMonitoriaMcpDto extends FiltroAtendimentosDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;
}

/* --- escopo atendimento --- */

export class AtendimentoMcpDto {
  @CampoId('atendimentoId', 'ID do atendimento.')
  atendimentoId: string;
}

export class ReagendarAtendimentoMcpDto extends ReagendarAtendimentoDto {
  @CampoId('atendimentoId', 'ID do atendimento a reagendar.')
  atendimentoId: string;
}

export class AtualizarAtendimentoMcpDto extends AtualizarAtendimentoDto {
  @CampoId('atendimentoId', 'ID do atendimento a alterar.')
  atendimentoId: string;
}

export class RealizarAtendimentoMcpDto extends RealizarAtendimentoDto {
  @CampoId('atendimentoId', 'ID do atendimento a marcar como realizado.')
  atendimentoId: string;
}

export class CancelarAtendimentoMcpDto extends CancelarAtendimentoDto {
  @CampoId('atendimentoId', 'ID do atendimento a cancelar.')
  atendimentoId: string;
}
