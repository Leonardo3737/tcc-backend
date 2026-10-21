import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PapelMonitoria } from '../../../common/enums/papel-monitoria.enum';
import { StatusMonitoria } from '../../../common/enums/status-monitoria.enum';
import { Monitoria } from '../entities/monitoria.model';

export class ResumoDisciplinaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'MAT101' }) codigo: string;
  @ApiProperty({ example: 'Calculo I' }) nome: string;
}

export class ResumoProfessorDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Joao Ribeiro' }) nome: string;
}

export class MonitoriaRespostaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiPropertyOptional({ type: ResumoDisciplinaDto }) disciplina?: ResumoDisciplinaDto;
  @ApiPropertyOptional({ type: ResumoProfessorDto }) professor?: ResumoProfessorDto;
  @ApiProperty({ example: 2026 }) ano: number;
  @ApiProperty({ example: 2 }) semestre: number;

  @ApiProperty({ example: '2026/2', description: 'Periodo formatado para exibicao.' })
  periodo: string;

  @ApiPropertyOptional({ nullable: true }) descricao: string | null;
  @ApiProperty({ enum: StatusMonitoria }) status: StatusMonitoria;
  /**
   * Procedencia: o edital que originou a monitoria, quando houve um.
   *
   * Nulo significa "criada a mao", nao "dado faltando" — e a maioria.
   */
  @ApiPropertyOptional({
    nullable: true,
    format: 'uuid',
    description: 'Edital que originou a monitoria. Nulo quando foi criada diretamente.',
  })
  editalId: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date' }) dataInicio: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date' }) dataFim: string | null;

  @ApiPropertyOptional({
    enum: PapelMonitoria,
    nullable: true,
    description:
      'Papel do usuario autenticado NESTA monitoria. null quando ele nao participa. ' +
      'E contextual: o mesmo usuario pode ser MONITOR aqui e MONITORADO em outra.',
  })
  meuPapel?: PapelMonitoria | null;

  @ApiPropertyOptional({ description: 'Se o usuario autenticado e o professor responsavel.' })
  souResponsavel?: boolean;

  /**
   * ID do VINCULO do proprio usuario nesta monitoria (nao o id do usuario).
   *
   * Varias rotas pedem `participanteId` — avaliacoes de um monitor, filtro de
   * disponibilidades, filtro de atendimentos. Sem este campo, o cliente teria de
   * listar /participantes e se procurar comparando `alunoId`, refazendo um
   * trabalho que o ParticipacaoService ja fez para responder esta requisicao.
   */
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'ID do vinculo do usuario autenticado nesta monitoria. null quando ele nao ' +
      'participa (inclusive quando e apenas o professor responsavel).',
  })
  meuParticipanteId?: string | null;

  static deModelo(
    monitoria: Monitoria,
    extras?: {
      meuPapel?: PapelMonitoria | null;
      souResponsavel?: boolean;
      meuParticipanteId?: string | null;
    },
  ): MonitoriaRespostaDto {
    const dto = new MonitoriaRespostaDto();
    dto.id = monitoria.id;
    dto.ano = monitoria.ano;
    dto.semestre = monitoria.semestre;
    dto.periodo = `${monitoria.ano}/${monitoria.semestre}`;
    dto.descricao = monitoria.descricao;
    dto.status = monitoria.status;
    dto.editalId = monitoria.editalId ?? null;
    dto.dataInicio = monitoria.dataInicio;
    dto.dataFim = monitoria.dataFim;

    if (monitoria.disciplina) {
      dto.disciplina = {
        id: monitoria.disciplina.id,
        codigo: monitoria.disciplina.codigo,
        nome: monitoria.disciplina.nome,
      };
    }

    if (monitoria.professor?.usuario) {
      dto.professor = {
        id: monitoria.professor.usuarioId,
        nome: monitoria.professor.usuario.nome,
      };
    }

    if (extras) {
      dto.meuPapel = extras.meuPapel ?? null;
      dto.souResponsavel = extras.souResponsavel ?? false;
      dto.meuParticipanteId = extras.meuParticipanteId ?? null;
    }

    return dto;
  }
}
