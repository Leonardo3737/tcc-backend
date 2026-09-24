import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

import { PaginacaoDto } from '../../../common/dto/paginacao.dto';

/**
 * Filtro da listagem de materiais.
 *
 * `incluirRemovidos` precisa estar declarado AQUI, e nao extraido a parte com
 * `@Query('incluirRemovidos')`.
 *
 * Motivo: `@Query() filtro: FiltroMateriaisDto` faz o ValidationPipe global
 * validar o objeto de query INTEIRO contra este DTO. Como a aplicacao roda com
 * `forbidNonWhitelisted: true` (defesa contra mass assignment), qualquer chave
 * nao declarada aqui derruba a requisicao com 400 — mesmo que outro decorator
 * tambem a leia. Declarar o campo em um `@Query('chave')` separado nao o isenta
 * dessa validacao; apenas o extrai depois.
 */
export class FiltroMateriaisDto extends PaginacaoDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'true inclui os materiais removidos logicamente (RN10), que por padrao ficam ' +
      'fora da listagem.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'incluirRemovidos deve ser booleano' })
  incluirRemovidos: boolean = false;
}
