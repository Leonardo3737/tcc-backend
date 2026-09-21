import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';

import { StatusMonitoria } from '../../common/enums/status-monitoria.enum';
import { Monitoria } from '../monitorias/entities/monitoria.model';
import { MonitoriaParticipante } from '../monitorias/entities/monitoria-participante.model';
import { Aluno } from '../usuarios/entities/aluno.model';
import { Usuario } from '../usuarios/entities/usuario.model';
import { CriarDisponibilidadeDto } from './dto/criar-disponibilidade.dto';
import { DisponibilidadeRespostaDto } from './dto/disponibilidade-resposta.dto';
import { FiltroDisponibilidadesDto } from './dto/filtro-disponibilidades.dto';
import { Disponibilidade } from './entities/disponibilidade.model';

const INCLUDE_MONITOR = [
  {
    model: MonitoriaParticipante,
    include: [{ model: Aluno, include: [{ model: Usuario, attributes: ['id', 'nome'] }] }],
  },
];

@Injectable()
export class DisponibilidadesService {
  constructor(
    @InjectModel(Disponibilidade) private readonly disponibilidadeModel: typeof Disponibilidade,
    private readonly config: ConfigService,
  ) {}

  /**
   * Declara uma faixa semanal de disponibilidade do monitor.
   *
   * Duas validacoes acontecem aqui, em camadas diferentes:
   *  - intervalo invalido (fim <= inicio) e barrado por CHECK e tambem antes,
   *    para produzir mensagem clara;
   *  - sobreposicao com outra faixa ativa e barrada pela constraint EXCLUDE
   *    `ex_disponibilidade_sem_sobreposicao`, que e o unico mecanismo confiavel
   *    sob requisicoes concorrentes.
   */
  async criar(
    monitoria: Monitoria,
    participanteMonitor: MonitoriaParticipante,
    dto: CriarDisponibilidadeDto,
  ): Promise<DisponibilidadeRespostaDto> {
    if (
      monitoria.status === StatusMonitoria.ENCERRADA ||
      monitoria.status === StatusMonitoria.CANCELADA
    ) {
      throw new ConflictException(
        `Monitoria ${monitoria.status.toLowerCase()} nao aceita novas disponibilidades.`,
      );
    }

    const inicio = this.normalizarHora(dto.horaInicio);
    const fim = this.normalizarHora(dto.horaFim);

    if (fim <= inicio) {
      throw new BadRequestException('horaFim deve ser posterior a horaInicio.');
    }

    const disponibilidade = await this.disponibilidadeModel.create({
      participanteId: participanteMonitor.id,
      monitoriaId: monitoria.id,
      diaSemana: dto.diaSemana,
      horaInicio: inicio,
      horaFim: fim,
      ativa: true,
    });

    return DisponibilidadeRespostaDto.deModelo(disponibilidade);
  }

  async listar(
    monitoriaId: string,
    filtro: FiltroDisponibilidadesDto,
  ): Promise<DisponibilidadeRespostaDto[]> {
    const where: Record<string, unknown> = {
      monitoriaId,
      ativa: filtro.ativa ?? true,
    };

    if (filtro.participanteId) {
      where.participanteId = filtro.participanteId;
    }

    const disponibilidades = await this.disponibilidadeModel.findAll({
      where,
      include: INCLUDE_MONITOR,
      order: [
        ['dia_semana', 'ASC'],
        ['hora_inicio', 'ASC'],
      ],
    });

    return disponibilidades.map(DisponibilidadeRespostaDto.deModelo);
  }

  /**
   * Desativa a faixa em vez de apagar (RN10): atendimentos ja agendados foram
   * validados contra ela, e apagar a linha destruiria a justificativa historica
   * daqueles agendamentos.
   */
  async desativar(
    monitoriaId: string,
    disponibilidadeId: string,
    participanteMonitor: MonitoriaParticipante,
  ): Promise<DisponibilidadeRespostaDto> {
    const disponibilidade = await this.disponibilidadeModel.findByPk(disponibilidadeId);

    if (!disponibilidade || disponibilidade.monitoriaId !== monitoriaId) {
      throw new NotFoundException('Disponibilidade nao encontrada nesta monitoria.');
    }

    if (disponibilidade.participanteId !== participanteMonitor.id) {
      throw new ConflictException('Esta disponibilidade pertence a outro monitor.');
    }

    if (!disponibilidade.ativa) {
      throw new ConflictException('Esta disponibilidade ja esta desativada.');
    }

    await disponibilidade.update({ ativa: false });

    return DisponibilidadeRespostaDto.deModelo(disponibilidade);
  }

  /**
   * Verifica se um atendimento cabe dentro de alguma faixa declarada pelo monitor.
   *
   * A conversao de fuso e feita pelo PostgreSQL (AT TIME ZONE), nao pelo Node:
   * o horario da disponibilidade e local ("terca, 14h") e o do atendimento e
   * absoluto (TIMESTAMPTZ). Deixar essa conta para o processo da aplicacao a
   * tornaria dependente do fuso do servidor — que muda entre a maquina do
   * desenvolvedor e o container de producao.
   *
   * A checagem de mesma data local tambem impede que um atendimento atravesse a
   * meia-noite e "case" com a faixa do dia seguinte.
   */
  async validarJanela(monitorParticipanteId: string, inicio: Date, fim: Date): Promise<void> {
    const fuso = this.config.getOrThrow<string>('agenda.fusoHorario');

    const resultado = await this.disponibilidadeModel.sequelize!.query<{ cabe: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM disponibilidades d
        WHERE d.participante_id = :participanteId
          AND d.ativa
          AND d.dia_semana = EXTRACT(DOW FROM (:inicio::timestamptz AT TIME ZONE :fuso))
          AND d.hora_inicio <= (:inicio::timestamptz AT TIME ZONE :fuso)::time
          AND d.hora_fim    >= (:fim::timestamptz    AT TIME ZONE :fuso)::time
          AND (:inicio::timestamptz AT TIME ZONE :fuso)::date
            = (:fim::timestamptz    AT TIME ZONE :fuso)::date
      ) AS cabe;
      `,
      {
        replacements: {
          participanteId: monitorParticipanteId,
          inicio: inicio.toISOString(),
          fim: fim.toISOString(),
          fuso,
        },
        type: QueryTypes.SELECT,
        plain: true,
      },
    );

    if (!resultado?.cabe) {
      throw new ConflictException(
        'O horario solicitado nao esta dentro de nenhuma disponibilidade ativa deste monitor.',
      );
    }
  }

  private normalizarHora(hora: string): string {
    return hora.length === 5 ? `${hora}:00` : hora;
  }
}
