import { ApiProperty } from '@nestjs/swagger';

import { TipoPontuacao } from '../../../common/enums/tipo-pontuacao.enum';

export class RegraDePontuacaoDto {
  @ApiProperty({ enum: TipoPontuacao })
  tipo: TipoPontuacao;

  /**
   * `null` quando os pontos sao VARIAVEIS, nao quando valem zero.
   *
   * `AVALIACAO_RECEBIDA` vale a propria nota (1 a 5), entao nao ha numero fixo
   * a informar. A constante interna guarda `0` apenas porque o tipo exige um
   * numero; devolver esse `0` ao cliente faria a tela anunciar que avaliacao
   * nao pontua — o oposto do que acontece.
   */
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 10,
    description: 'Pontos fixos, ou null quando o valor e variavel (ver descricao).',
  })
  pontos: number | null;

  @ApiProperty({ example: 'Concedido ao monitor a cada atendimento marcado como realizado.' })
  descricao: string;
}

export class RegrasDePontuacaoRespostaDto {
  @ApiProperty({ type: [RegraDePontuacaoDto] })
  regras: RegraDePontuacaoDto[];
}
