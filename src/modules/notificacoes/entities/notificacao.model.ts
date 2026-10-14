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

import { TipoNotificacao } from '../../../common/enums/tipo-notificacao.enum';
import { Usuario } from '../../usuarios/entities/usuario.model';

/**
 * Uma linha = um aviso para uma pessoa sobre um fato.
 *
 * A linha nasce com `enviadoEm` nulo (reservada) e e preenchida quando o
 * provedor aceita a mensagem. Nunca e apagada: alem do reenvio, ela responde
 * "esta pessoa foi avisada?" depois do fato — que e quando a pergunta aparece.
 */
@Table({ tableName: 'notificacoes', underscored: true, timestamps: true })
export class Notificacao extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: false })
  usuarioId: string;

  /**
   * `DataType.ENUM` com os valores: o Sequelize usa a lista para validar e para
   * resolver o tipo `enum_notificacoes_tipo` no PostgreSQL.
   */
  @Column({ type: DataType.ENUM(...Object.values(TipoNotificacao)), allowNull: false })
  tipo: TipoNotificacao;

  /** Id do fato de origem. Sem FK: ver a migration. */
  @Column({ type: DataType.UUID, allowNull: false })
  referenciaId: string;

  @Column({ type: DataType.STRING(200), allowNull: false })
  assunto: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  corpo: string;

  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false })
  tentativas: number;

  @Column({ type: DataType.DATE, allowNull: true })
  enviadoEm: Date | null;

  @BelongsTo(() => Usuario)
  usuario?: Usuario;

  declare createdAt: Date;
}
