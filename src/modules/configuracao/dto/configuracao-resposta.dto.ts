import { ApiProperty } from '@nestjs/swagger';

export class LimitesAgendamentoDto {
  @ApiProperty({ example: 15 }) duracaoMinimaMinutos: number;
  @ApiProperty({ example: 240 }) duracaoMaximaMinutos: number;

  @ApiProperty({ example: 0, description: '0 = qualquer horario futuro e aceito.' })
  antecedenciaMinimaMinutos: number;

  @ApiProperty({ example: 0, description: '0 = o aluno pode desistir ate o inicio.' })
  cancelamentoAntecedenciaMinutos: number;
}

export class ConfiguracaoRespostaDto {
  /**
   * O dado que evita a armadilha de integracao mais provavel do projeto.
   *
   * A disponibilidade do monitor e declarada em hora LOCAL da instituicao; o
   * atendimento e TIMESTAMPTZ. Se o frontend montar `inicio` a partir do fuso do
   * navegador, o agendamento e recusado com "horario fora da disponibilidade" e
   * o usuario nao entende o motivo. Expor o fuso aqui evita que esse valor fique
   * duplicado e hardcoded nos dois lados.
   */
  @ApiProperty({
    example: 'America/Porto_Velho',
    description:
      'Fuso em que as disponibilidades sao interpretadas. Use-o para converter os ' +
      'horarios exibidos ao usuario antes de montar inicio/fim do agendamento.',
  })
  fusoHorario: string;

  @ApiProperty({ type: LimitesAgendamentoDto })
  agendamento: LimitesAgendamentoDto;
}
