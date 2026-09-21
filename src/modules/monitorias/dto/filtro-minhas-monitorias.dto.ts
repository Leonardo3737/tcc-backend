import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { PaginacaoDto } from '../../../common/dto/paginacao.dto';
import { StatusMonitoria } from '../../../common/enums/status-monitoria.enum';

/**
 * Status considerados "em andamento".
 *
 * E o default de /monitorias/minhas porque a rota alimenta o dashboard: quem
 * abre a plataforma quer ver o que esta acontecendo agora, nao 20 semestres de
 * historico. Consultar o passado continua possivel — basta pedir os status
 * terminais explicitamente.
 */
export const STATUS_EM_ANDAMENTO = [StatusMonitoria.PLANEJADA, StatusMonitoria.ATIVA];

export class FiltroMinhasMonitoriasDto extends PaginacaoDto {
  /**
   * Aceita repeticao (`?status=ATIVA&status=ENCERRADA`).
   *
   * Um enum de valor unico impediria pedir "encerradas E canceladas" de uma vez,
   * e obrigaria a inventar um valor sentinela do tipo `?status=TODAS` — que nao
   * e um status. A lista resolve os dois casos com o mesmo parametro.
   */
  @ApiPropertyOptional({
    enum: StatusMonitoria,
    isArray: true,
    description:
      'Padrao: PLANEJADA e ATIVA (visao de dashboard). Informe explicitamente para ' +
      'consultar o historico, ex.: ?status=ENCERRADA&status=CANCELADA',
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray({ message: 'status deve ser um ou mais valores validos' })
  @IsEnum(StatusMonitoria, { each: true, message: 'status contem um valor invalido' })
  status?: StatusMonitoria[];

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ano deve ser um numero inteiro' })
  @Min(2000, { message: 'ano deve ser no minimo 2000' })
  @Max(2100, { message: 'ano deve ser no maximo 2100' })
  ano?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'semestre deve ser um numero inteiro' })
  @Min(1, { message: 'semestre deve ser 1 ou 2' })
  @Max(2, { message: 'semestre deve ser 1 ou 2' })
  semestre?: number;
}
