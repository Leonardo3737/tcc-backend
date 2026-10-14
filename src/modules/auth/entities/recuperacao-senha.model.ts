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

import { Usuario } from '../../usuarios/entities/usuario.model';

/**
 * Um pedido de recuperacao de senha.
 *
 * A linha nasce ativa (`usadoEm` e `invalidadoEm` nulos) e sai desse estado uma
 * unica vez: ou foi consumida, ou foi invalidada. Nunca volta. O indice unico
 * parcial do banco garante que exista no maximo uma linha ativa por usuario.
 *
 * `codigoHash` nao tem escopo de exclusao como `senhaHash` tem em Usuario, e
 * nao precisa: esta tabela nao e serializada para o cliente em lugar nenhum —
 * nao ha DTO de resposta nem rota que a exponha.
 */
@Table({ tableName: 'recuperacoes_senha', underscored: true, timestamps: true })
export class RecuperacaoSenha extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: false })
  usuarioId: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  codigoHash: string;

  @Column({ type: DataType.DATE, allowNull: false })
  expiraEm: Date;

  @Default(0)
  @Column({ type: DataType.SMALLINT, allowNull: false })
  tentativas: number;

  @Column({ type: DataType.DATE, allowNull: true })
  usadoEm: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  invalidadoEm: Date | null;

  @BelongsTo(() => Usuario)
  usuario?: Usuario;
}
