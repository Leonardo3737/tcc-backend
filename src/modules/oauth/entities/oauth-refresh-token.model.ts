import { Column, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';

import { Usuario } from '../../usuarios/entities/usuario.model';
import { OAuthCliente } from './oauth-cliente.model';

/** Refresh token rotativo: cada uso revoga o atual e emite um novo. */
@Table({ tableName: 'oauth_refresh_tokens', underscored: true, timestamps: true })
export class OAuthRefreshToken extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  tokenHash: string;

  @ForeignKey(() => OAuthCliente)
  @Column({ type: DataType.UUID, allowNull: false })
  clienteId: string;

  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: false })
  usuarioId: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  escopo: string | null;

  @Column({ type: DataType.DATE, allowNull: false })
  expiraEm: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  revogadoEm: Date | null;
}
