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

import { StatusAtendimento } from '../../../common/enums/status-atendimento.enum';
import { Usuario } from '../../usuarios/entities/usuario.model';
import { Atendimento } from './atendimento.model';

/**
 * Trilha append-only das transicoes de status.
 *
 * `timestamps: false` porque a linha nunca muda: uma transicao que ja aconteceu
 * nao pode ser "atualizada". `updatedAt` aqui seria uma mentira em potencial.
 */
@Table({
  tableName: 'atendimento_status_historico',
  underscored: true,
  timestamps: false,
})
export class AtendimentoStatusHistorico extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Atendimento)
  @Column({ type: DataType.UUID, allowNull: false })
  atendimentoId: string;

  /** NULL somente na primeira linha, que registra a criacao do atendimento. */
  @Column({ type: DataType.STRING(20), allowNull: true })
  statusAnterior: StatusAtendimento | null;

  @Column({ type: DataType.STRING(20), allowNull: false })
  statusNovo: StatusAtendimento;

  @Column({ type: DataType.TEXT, allowNull: true })
  motivo: string | null;

  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: false })
  alteradoPorUsuarioId: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false })
  criadoEm: Date;

  @BelongsTo(() => Usuario)
  alteradoPor?: Usuario;
}
