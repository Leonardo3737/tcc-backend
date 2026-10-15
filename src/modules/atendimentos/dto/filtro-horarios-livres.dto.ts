import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsUUID } from 'class-validator';

/**
 * Janela de busca por horarios livres.
 *
 * `de` e `ate` sao obrigatorios porque nao existe resposta util para "todos os
 * horarios livres": a expansao das faixas semanais e infinita no tempo, e o
 * cliente sempre sabe o periodo que esta exibindo.
 */
export class FiltroHorariosLivresDto {
  @ApiProperty({ example: '2026-10-20T00:00:00.000Z', format: 'date-time' })
  @IsISO8601({}, { message: 'de deve estar no formato ISO 8601' })
  de: string;

  @ApiProperty({ example: '2026-10-27T00:00:00.000Z', format: 'date-time' })
  @IsISO8601({}, { message: 'ate deve estar no formato ISO 8601' })
  ate: string;

  /**
   * Tamanho do slot. Omitido, usa `agenda.duracaoPadraoMinutos` (B1).
   *
   * Os limites minimo e maximo nao sao declarados aqui: eles sao configuraveis
   * por instituicao (D-15), e repeti-los como literal neste DTO criaria duas
   * fontes que podem divergir. A validacao fica no service, contra a
   * configuracao viva.
   */
  @ApiPropertyOptional({
    example: 60,
    description: 'Omitido, usa a duracao padrao de GET /configuracao.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'duracaoMinutos deve ser um numero inteiro' })
  duracaoMinutos?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Omitido, considera todos os monitores ativos da monitoria.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'monitorParticipanteId deve ser um UUID valido' })
  monitorParticipanteId?: string;
}
