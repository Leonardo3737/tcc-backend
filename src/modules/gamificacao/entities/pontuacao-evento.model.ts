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

import { TipoPontuacao } from '../../../common/enums/tipo-pontuacao.enum';
import { Monitoria } from '../../monitorias/entities/monitoria.model';
import { Usuario } from '../../usuarios/entities/usuario.model';

/**
 * Uma linha = um fato que gerou pontos. Tabela append-only.
 *
 * Nao existe coluna de saldo em lugar nenhum do sistema: o total de um usuario e
 * sempre SUM(pontos). Isso mantem a pontuacao auditavel e permite mudar as regras
 * sem migrar dados.
 */
@Table({ tableName: 'pontuacao_eventos', underscored: true, timestamps: false })
export class PontuacaoEvento extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: false })
  usuarioId: string;

  @ForeignKey(() => Monitoria)
  @Column({ type: DataType.UUID, allowNull: false })
  monitoriaId: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  tipo: TipoPontuacao;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  pontos: number;

  /** Id do fato de origem (atendimento, avaliacao). Sem FK: ver a migration. */
  @Column({ type: DataType.UUID, allowNull: false })
  referenciaId: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false })
  criadoEm: Date;

  @BelongsTo(() => Usuario)
  usuario?: Usuario;
}
