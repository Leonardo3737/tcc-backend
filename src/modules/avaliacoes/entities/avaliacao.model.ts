import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';

import { AtendimentoParticipante } from '../../atendimentos/entities/atendimento-participante.model';

/**
 * Avaliacao de um atendimento por UM monitorado.
 *
 * Aponta para a INSCRICAO, nao para o atendimento: e a inscricao que prova que
 * aquela pessoa esteve naquela sessao (RN05). Em sessao coletiva, cada
 * monitorado tem a sua avaliacao.
 */
@Table({ tableName: 'avaliacoes', underscored: true, timestamps: true })
export class Avaliacao extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @Unique
  @ForeignKey(() => AtendimentoParticipante)
  @Column({ type: DataType.UUID, allowNull: false })
  atendimentoParticipanteId: string;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  nota: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  comentario: string | null;

  @BelongsTo(() => AtendimentoParticipante)
  inscricao?: AtendimentoParticipante;

  declare createdAt: Date;
  declare updatedAt: Date;
}
