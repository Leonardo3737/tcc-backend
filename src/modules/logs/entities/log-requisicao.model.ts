import { Column, DataType, Default, Model, PrimaryKey, Table } from 'sequelize-typescript';

/**
 * Uma linha = uma requisicao HTTP atendida.
 *
 * Sem associacao com `Usuario`: `usuarioId` e referencia fraca, sem FK — ver a
 * migration. Declarar um `@BelongsTo` aqui sugeriria uma integridade que o
 * banco nao garante.
 */
@Table({ tableName: 'logs_requisicao', underscored: true, timestamps: false })
export class LogRequisicao extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @Column({ type: DataType.UUID, allowNull: true })
  usuarioId: string | null;

  @Column({ type: DataType.STRING(10), allowNull: false })
  metodo: string;

  @Column({ type: DataType.STRING(500), allowNull: false })
  caminho: string;

  @Column({ type: DataType.STRING(300), allowNull: true })
  rota: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  statusHttp: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  duracaoMs: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  corpo: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  query: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  resposta: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  erro: string | null;

  @Column({ type: DataType.STRING(60), allowNull: true })
  ip: string | null;

  @Column({ type: DataType.STRING(300), allowNull: true })
  userAgent: string | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false })
  criadoEm: Date;
}
