import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Paginacao por offset. Suficiente para listas administrativas pequenas
 * (alunos e professores de uma instituicao) e simples de consumir no frontend.
 * O teto de 100 evita que um cliente peca a base inteira em uma requisicao.
 */
export class PaginacaoDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pagina deve ser um numero inteiro' })
  @Min(1, { message: 'pagina deve ser no minimo 1' })
  pagina: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limite deve ser um numero inteiro' })
  @Min(1, { message: 'limite deve ser no minimo 1' })
  @Max(100, { message: 'limite deve ser no maximo 100' })
  limite: number = 20;

  get offset(): number {
    return (this.pagina - 1) * this.limite;
  }
}
