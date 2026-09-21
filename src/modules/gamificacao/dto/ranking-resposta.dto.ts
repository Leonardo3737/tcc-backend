import { ApiProperty } from '@nestjs/swagger';

import { TipoPontuacao } from '../../../common/enums/tipo-pontuacao.enum';

export class PosicaoRankingDto {
  @ApiProperty({ example: 1 }) posicao: number;
  @ApiProperty({ format: 'uuid' }) usuarioId: string;
  @ApiProperty({ example: 'Ana Martins' }) nome: string;
  @ApiProperty({ example: 85 }) pontos: number;
  @ApiProperty({ example: 12, description: 'Quantidade de eventos que geraram pontos.' })
  eventos: number;
}

export class EventoPontuacaoDto {
  @ApiProperty({ enum: TipoPontuacao }) tipo: TipoPontuacao;
  @ApiProperty({ example: 10 }) pontos: number;
  @ApiProperty({ format: 'uuid' }) monitoriaId: string;
  @ApiProperty({ format: 'uuid', description: 'Atendimento ou avaliacao de origem.' })
  referenciaId: string;
  @ApiProperty() criadoEm: Date;
}

export class ResumoPontuacaoDto {
  @ApiProperty({ format: 'uuid' }) usuarioId: string;
  @ApiProperty({ example: 85 }) total: number;
  @ApiProperty({ example: { ATENDIMENTO_REALIZADO: 60, AVALIACAO_RECEBIDA: 25 } })
  porTipo: Record<string, number>;
  @ApiProperty({ type: [EventoPontuacaoDto] }) ultimosEventos: EventoPontuacaoDto[];
}
