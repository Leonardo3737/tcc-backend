import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Avaliacao } from '../entities/avaliacao.model';

export class AvaliacaoRespostaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) atendimentoParticipanteId: string;
  @ApiPropertyOptional({ format: 'uuid' }) atendimentoId?: string;
  @ApiProperty({ example: 5 }) nota: number;
  @ApiPropertyOptional({ nullable: true }) comentario: string | null;
  @ApiProperty() criadoEm: Date;

  /**
   * A resposta NAO expoe quem avaliou.
   *
   * O monitor precisa da nota para melhorar; saber quem deu qual nota so criaria
   * constrangimento entre colegas. Quem avaliou continua registrado no banco
   * (via inscricao) para auditoria, mas nao trafega na API.
   */
  static deModelo(avaliacao: Avaliacao): AvaliacaoRespostaDto {
    const dto = new AvaliacaoRespostaDto();
    dto.id = avaliacao.id;
    dto.atendimentoParticipanteId = avaliacao.atendimentoParticipanteId;
    dto.atendimentoId = avaliacao.inscricao?.atendimentoId;
    dto.nota = avaliacao.nota;
    dto.comentario = avaliacao.comentario;
    dto.criadoEm = avaliacao.createdAt;
    return dto;
  }
}

export class ResumoAvaliacoesDto {
  @ApiProperty({ example: 12 }) total: number;
  @ApiProperty({ example: 4.6, nullable: true }) media: number | null;
  @ApiProperty({ type: [AvaliacaoRespostaDto] }) avaliacoes: AvaliacaoRespostaDto[];
}
