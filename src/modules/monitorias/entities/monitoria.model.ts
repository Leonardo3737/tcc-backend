import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

import { StatusMonitoria } from '../../../common/enums/status-monitoria.enum';
import { Disciplina } from '../../disciplinas/entities/disciplina.model';
import { Professor } from '../../usuarios/entities/professor.model';
import { MonitoriaParticipante } from './monitoria-participante.model';

/**
 * O agregado central: oferta de apoio academico de uma disciplina, em um
 * periodo, sob responsabilidade de um professor.
 */
@Table({ tableName: 'monitorias', underscored: true, timestamps: true })
export class Monitoria extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Disciplina)
  @Column({ type: DataType.UUID, allowNull: false })
  disciplinaId: string;

  @ForeignKey(() => Professor)
  @Column({ type: DataType.UUID, allowNull: false })
  professorId: string;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  ano: number;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  semestre: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  descricao: string | null;

  @Default(StatusMonitoria.PLANEJADA)
  @Column({ type: DataType.STRING(20), allowNull: false })
  status: StatusMonitoria;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  dataInicio: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  dataFim: string | null;

  @BelongsTo(() => Disciplina)
  disciplina?: Disciplina;

  @BelongsTo(() => Professor)
  professor?: Professor;

  @HasMany(() => MonitoriaParticipante)
  participantes?: MonitoriaParticipante[];

  declare createdAt: Date;
  declare updatedAt: Date;
}
