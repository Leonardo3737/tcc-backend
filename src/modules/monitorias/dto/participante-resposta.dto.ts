import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PapelMonitoria } from '../../../common/enums/papel-monitoria.enum';
import { StatusParticipacao } from '../../../common/enums/status-participacao.enum';
import { MonitoriaParticipante } from '../entities/monitoria-participante.model';

export class ParticipanteRespostaDto {
  @ApiProperty({ format: 'uuid', description: 'ID do VINCULO, nao do aluno.' })
  id: string;

  @ApiProperty({ format: 'uuid' }) monitoriaId: string;
  @ApiProperty({ format: 'uuid' }) alunoId: string;
  @ApiPropertyOptional({ example: 'Ana Martins' }) nomeAluno?: string;
  @ApiPropertyOptional({ example: '2021001234' }) matricula?: string;

  @ApiProperty({
    enum: PapelMonitoria,
    description: 'Papel DENTRO desta monitoria. Nao e um tipo de usuario.',
  })
  papel: PapelMonitoria;

  @ApiProperty({ enum: StatusParticipacao }) status: StatusParticipacao;
  @ApiProperty() ingressouEm: Date;
  @ApiPropertyOptional({ nullable: true }) encerradoEm: Date | null;

  static deModelo(participante: MonitoriaParticipante): ParticipanteRespostaDto {
    const dto = new ParticipanteRespostaDto();
    dto.id = participante.id;
    dto.monitoriaId = participante.monitoriaId;
    dto.alunoId = participante.alunoId;
    dto.papel = participante.papel;
    dto.status = participante.status;
    dto.ingressouEm = participante.ingressouEm;
    dto.encerradoEm = participante.encerradoEm;

    if (participante.aluno) {
      dto.matricula = participante.aluno.matricula;
      dto.nomeAluno = participante.aluno.usuario?.nome;
    }

    return dto;
  }
}
