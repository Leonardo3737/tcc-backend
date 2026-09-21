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

import { ModalidadeAtendimento } from '../../../common/enums/modalidade-atendimento.enum';
import { OrigemAtendimento } from '../../../common/enums/origem-atendimento.enum';
import { StatusAtendimento } from '../../../common/enums/status-atendimento.enum';
import { Monitoria } from '../../monitorias/entities/monitoria.model';
import { MonitoriaParticipante } from '../../monitorias/entities/monitoria-participante.model';
import { Usuario } from '../../usuarios/entities/usuario.model';
import { AtendimentoParticipante } from './atendimento-participante.model';
import { AtendimentoStatusHistorico } from './atendimento-status-historico.model';

/**
 * A sessao de monitoria.
 *
 * Nao existe `monitoradoId` aqui: os atendidos vivem em
 * atendimento_participantes, porque a sessao pode ser coletiva (D-03).
 * Atendimento individual e apenas `vagas = 1`.
 *
 * A coluna tecnica `monitor_papel` (fixa em 'MONITOR', parte da FK composta que
 * garante RN01/RN02/RN04 no banco) nao e mapeada de proposito.
 */
@Table({ tableName: 'atendimentos', underscored: true, timestamps: true })
export class Atendimento extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Monitoria)
  @Column({ type: DataType.UUID, allowNull: false })
  monitoriaId: string;

  @ForeignKey(() => MonitoriaParticipante)
  @Column({ type: DataType.UUID, allowNull: false })
  monitorParticipanteId: string;

  @Column({ type: DataType.DATE, allowNull: false })
  inicio: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  fim: Date;

  /** Capacidade da sessao. 1 = atendimento individual. */
  @Default(1)
  @Column({ type: DataType.SMALLINT, allowNull: false })
  vagas: number;

  @Column({ type: DataType.STRING(20), allowNull: false })
  modalidade: ModalidadeAtendimento;

  @Column({ type: DataType.STRING(150), allowNull: true })
  local: string | null;

  @Column({ type: DataType.STRING(200), allowNull: false })
  assunto: string;

  @Default(StatusAtendimento.AGENDADO)
  @Column({ type: DataType.STRING(20), allowNull: false })
  status: StatusAtendimento;

  @Column({ type: DataType.STRING(30), allowNull: false })
  origem: OrigemAtendimento;

  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: false })
  criadoPorUsuarioId: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  motivoCancelamento: string | null;

  @BelongsTo(() => Monitoria)
  monitoria?: Monitoria;

  @BelongsTo(() => MonitoriaParticipante)
  monitor?: MonitoriaParticipante;

  @HasMany(() => AtendimentoParticipante)
  inscricoes?: AtendimentoParticipante[];

  @HasMany(() => AtendimentoStatusHistorico)
  historico?: AtendimentoStatusHistorico[];

  declare createdAt: Date;
  declare updatedAt: Date;
}
