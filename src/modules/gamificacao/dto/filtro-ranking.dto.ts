import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class FiltroRankingDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Restringe o ranking a uma monitoria.' })
  @IsOptional()
  @IsUUID('4', { message: 'monitoriaId deve ser um UUID valido' })
  monitoriaId?: string;

  /**
   * Reusado pelas duas rotas de gamificacao com o mesmo significado — "quantos
   * itens devolver": posicoes no /ranking, eventos recentes no /meus-pontos.
   * Por isso nao foi criado um DTO separado.
   */
  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: 100,
    description:
      'Quantidade de itens: posicoes em /ranking, ultimosEventos em /meus-pontos. ' +
      'Nao afeta os totais agregados.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limite deve ser um numero inteiro' })
  @Min(1, { message: 'limite deve ser no minimo 1' })
  @Max(100, { message: 'limite deve ser no maximo 100' })
  limite: number = 20;
}
