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

import { MonitoriaParticipante } from '../../monitorias/entities/monitoria-participante.model';

/**
 * Recorrencia semanal declarada pelo monitor.
 *
 * A coluna tecnica `papel_esperado` existe no banco (valor fixo 'MONITOR', parte
 * da FK composta que impede um MONITORADO de declarar disponibilidade) e NAO e
 * mapeada aqui de proposito: o DEFAULT do banco a preenche, e nao ha nenhuma
 * situacao em que a aplicacao deva escreve-la.
 */
@Table({ tableName: 'disponibilidades', underscored: true, timestamps: true })
export class Disponibilidade extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => MonitoriaParticipante)
  @Column({ type: DataType.UUID, allowNull: false })
  participanteId: string;

  @Column({ type: DataType.UUID, allowNull: false })
  monitoriaId: string;

  /** 0 = domingo ... 6 = sabado (compativel com EXTRACT(DOW) e Date.getDay()). */
  @Column({ type: DataType.SMALLINT, allowNull: false })
  diaSemana: number;

  @Column({ type: DataType.TIME, allowNull: false })
  horaInicio: string;

  @Column({ type: DataType.TIME, allowNull: false })
  horaFim: string;

  /** Desativar em vez de apagar: a faixa ja pode ter lastreado atendimentos (RN10). */
  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  ativa: boolean;

  @BelongsTo(() => MonitoriaParticipante)
  participante?: MonitoriaParticipante;

  declare createdAt: Date;
  declare updatedAt: Date;
}
