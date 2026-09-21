import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

import { StatusInscricao } from '../../../common/enums/status-inscricao.enum';
import { MonitoriaParticipante } from '../../monitorias/entities/monitoria-participante.model';
import { Usuario } from '../../usuarios/entities/usuario.model';
import { Atendimento } from './atendimento.model';

/**
 * A inscricao de um monitorado em uma sessao.
 *
 * `inicio` e `fim` sao copias das colunas do atendimento. A copia existe para
 * viabilizar a constraint EXCLUDE que garante a RN03 do lado do aluno, e e
 * mantida coerente pelo banco (ON UPDATE CASCADE da FK composta) — a aplicacao
 * nunca deve atualizar esses campos por conta propria.
 */
@Table({ tableName: 'atendimento_participantes', underscored: true, timestamps: true })
export class AtendimentoParticipante extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Atendimento)
  @Column({ type: DataType.UUID, allowNull: false })
  atendimentoId: string;

  @Column({ type: DataType.UUID, allowNull: false })
  monitoriaId: string;

  @Column({ type: DataType.DATE, allowNull: false })
  inicio: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  fim: Date;

  @ForeignKey(() => MonitoriaParticipante)
  @Column({ type: DataType.UUID, allowNull: false })
  participanteId: string;

  @Default(StatusInscricao.INSCRITO)
  @Column({ type: DataType.STRING(20), allowNull: false })
  status: StatusInscricao;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false })
  inscritoEm: Date;

  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: false })
  inscritoPorUsuarioId: string;

  @BelongsTo(() => Atendimento)
  atendimento?: Atendimento;

  @BelongsTo(() => MonitoriaParticipante)
  participante?: MonitoriaParticipante;

  declare createdAt: Date;
  declare updatedAt: Date;
}
