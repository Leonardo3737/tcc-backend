import { ApiProperty } from '@nestjs/swagger';

/**
 * Um slot sugerido. NAO e reserva.
 *
 * O calculo e uma fotografia do instante da consulta: entre esta resposta e o
 * POST de agendamento, outra pessoa pode ocupar o mesmo slot. A verificacao
 * autoritativa continua no agendamento, que revalida janela, conflito do
 * monitor e conflito do solicitante contra as constraints.
 */
export class HorarioLivreDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-21T18:00:00.000Z' })
  inicio: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T19:00:00.000Z' })
  fim: string;

  @ApiProperty({ format: 'uuid', description: 'Vinculo do monitor que atenderia neste slot.' })
  monitorParticipanteId: string;

  @ApiProperty({ example: 'Ana Monitora' })
  nomeMonitor: string;
}

export class HorariosLivresRespostaDto {
  @ApiProperty({ type: [HorarioLivreDto] })
  horarios: HorarioLivreDto[];

  @ApiProperty({
    example: false,
    description:
      'true quando a lista foi cortada no teto de 500 slots. Reduza a janela ou filtre por monitor.',
  })
  truncado: boolean;
}
