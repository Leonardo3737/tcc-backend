import { CampoId } from '../../common/mcp/campo-id.decorator';
import { CriarAvaliacaoDto } from './dto/criar-avaliacao.dto';

export class AvaliarAtendimentoMcpDto extends CriarAvaliacaoDto {
  @CampoId('atendimentoId', 'ID do atendimento avaliado.')
  atendimentoId: string;
}

export class AvaliacoesDoAtendimentoMcpDto {
  @CampoId('atendimentoId', 'ID do atendimento.')
  atendimentoId: string;
}

export class AvaliacoesDoMonitorMcpDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;

  @CampoId('participanteId', 'ID do vinculo do monitor na monitoria.')
  participanteId: string;
}
