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

import { PapelMonitoria } from '../../../common/enums/papel-monitoria.enum';
import { StatusParticipacao } from '../../../common/enums/status-participacao.enum';
import { Aluno } from '../../usuarios/entities/aluno.model';
import { Usuario } from '../../usuarios/entities/usuario.model';
import { Monitoria } from './monitoria.model';

/**
 * O vinculo ALUNO + MONITORIA + PAPEL.
 *
 * Esta e a entidade que carrega a decisao central do dominio. Repare no que ela
 * NAO tem: nenhuma referencia a "monitor" ou "monitorado" como entidade. O papel
 * e uma coluna, porque so existe dentro do contexto de uma monitoria.
 *
 * Trocar de papel nunca e UPDATE em `papel`: encerra-se o vinculo atual e cria-se
 * outro, para que atendimentos antigos continuem apontando para o participante
 * correto da epoca (RN10).
 */
@Table({ tableName: 'monitoria_participantes', underscored: true, timestamps: true })
export class MonitoriaParticipante extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Monitoria)
  @Column({ type: DataType.UUID, allowNull: false })
  monitoriaId: string;

  @ForeignKey(() => Aluno)
  @Column({ type: DataType.UUID, allowNull: false })
  alunoId: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  papel: PapelMonitoria;

  @Default(StatusParticipacao.ATIVO)
  @Column({ type: DataType.STRING(20), allowNull: false })
  status: StatusParticipacao;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false })
  ingressouEm: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  encerradoEm: Date | null;

  /** Rastro da RN01: qual professor autorizou esta habilitacao. */
  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: true })
  habilitadoPorUsuarioId: string | null;

  @BelongsTo(() => Monitoria)
  monitoria?: Monitoria;

  @BelongsTo(() => Aluno)
  aluno?: Aluno;

  declare createdAt: Date;
  declare updatedAt: Date;
}
