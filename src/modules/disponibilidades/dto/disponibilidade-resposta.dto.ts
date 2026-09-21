import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Disponibilidade } from '../entities/disponibilidade.model';

const NOMES_DIA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

export class DisponibilidadeRespostaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid', description: 'Vinculo do monitor na monitoria.' })
  participanteId: string;

  @ApiProperty({ format: 'uuid' }) monitoriaId: string;
  @ApiProperty({ example: 2 }) diaSemana: number;
  @ApiProperty({ example: 'terca' }) diaSemanaNome: string;
  @ApiProperty({ example: '14:00:00' }) horaInicio: string;
  @ApiProperty({ example: '16:00:00' }) horaFim: string;
  @ApiProperty({ example: true }) ativa: boolean;
  @ApiPropertyOptional({ example: 'Ana Martins' }) nomeMonitor?: string;

  static deModelo(disponibilidade: Disponibilidade): DisponibilidadeRespostaDto {
    const dto = new DisponibilidadeRespostaDto();
    dto.id = disponibilidade.id;
    dto.participanteId = disponibilidade.participanteId;
    dto.monitoriaId = disponibilidade.monitoriaId;
    dto.diaSemana = disponibilidade.diaSemana;
    dto.diaSemanaNome = NOMES_DIA[disponibilidade.diaSemana] ?? '';
    dto.horaInicio = disponibilidade.horaInicio;
    dto.horaFim = disponibilidade.horaFim;
    dto.ativa = disponibilidade.ativa;
    dto.nomeMonitor = disponibilidade.participante?.aluno?.usuario?.nome;
    return dto;
  }
}
