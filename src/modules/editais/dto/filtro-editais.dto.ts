import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { PaginacaoDto } from '../../../common/dto/paginacao.dto';
import { DirecaoOrdenacao } from '../../atendimentos/dto/filtro-atendimentos.dto';

/**
 * Listagem administrativa de editais.
 *
 * `ativo` NAO tem default: a banca precisa poder ver os excluidos logicamente
 * para reativar um que foi desligado por engano. Omitir o filtro traz os dois,
 * e o campo `ativo` da resposta distingue. A rota publica e outra e nao usa
 * este DTO — la o filtro e imposto pelo servidor.
 */
export class FiltroEditaisDto extends PaginacaoDto {
  @ApiPropertyOptional({ example: 2026, minimum: 2000, maximum: 2100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ano deve ser um numero inteiro' })
  @Min(2000, { message: 'ano deve ser no minimo 2000' })
  @Max(2100, { message: 'ano deve ser no maximo 2100' })
  ano?: number;

  @ApiPropertyOptional({ example: 2, enum: [1, 2] })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'semestre deve ser um numero inteiro' })
  @Min(1, { message: 'semestre deve ser 1 ou 2' })
  @Max(2, { message: 'semestre deve ser 1 ou 2' })
  semestre?: number;

  @ApiPropertyOptional({ description: 'Omitido traz ativos e excluidos logicamente.' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'ativo deve ser booleano' })
  ativo?: boolean;

  /**
   * Ordena por `inicio_inscricoes`. Nao ha escolha de campo: um edital so tem
   * uma ordem util — a cronologica — e oferecer "ordenar por link" seria
   * superficie sem uso. A direcao existe porque a banca alterna entre "o que
   * esta vindo" e "o historico".
   */
  @ApiPropertyOptional({ enum: DirecaoOrdenacao, default: DirecaoOrdenacao.DESC })
  @IsOptional()
  @IsEnum(DirecaoOrdenacao, { message: 'direcao deve ser asc ou desc' })
  direcao: DirecaoOrdenacao = DirecaoOrdenacao.DESC;
}
