import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

export class MetaPaginacao {
  @ApiProperty({ example: 42 }) total: number;
  @ApiProperty({ example: 1 }) pagina: number;
  @ApiProperty({ example: 20 }) limite: number;
  @ApiProperty({ example: 3 }) totalPaginas: number;
}

/**
 * Envelope de listagem paginada.
 *
 * `dados` fica FORA do schema base, por dois motivos que se somam:
 *
 *  1. o tipo do item so existe em tempo de compilacao e seria apagado, gerando
 *     `items: {}` — inutil para gerar tipos;
 *  2. sem @ApiHideProperty, o plugin CLI do @nestjs/swagger infere o tipo de
 *     `dados: T[]` como a propria RespostaPaginada e a aplicacao NAO SOBE:
 *     "A circular dependency has been detected (property key: dados)".
 *
 * Quem descreve o campo e o decorator @ApiRespostaPaginada(Dto), que compoe o
 * schema com o item concreto de cada rota via allOf.
 */
export class RespostaPaginada<T> {
  @ApiHideProperty()
  dados: T[];

  @ApiProperty({ type: MetaPaginacao })
  meta: MetaPaginacao;

  constructor(dados: T[], total: number, pagina: number, limite: number) {
    this.dados = dados;
    this.meta = {
      total,
      pagina,
      limite,
      totalPaginas: Math.max(1, Math.ceil(total / limite)),
    };
  }
}
