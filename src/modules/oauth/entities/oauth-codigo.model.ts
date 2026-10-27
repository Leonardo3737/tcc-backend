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
import { OAuthCliente } from './oauth-cliente.model';

/** Codigo de autorizacao: vida de minutos, uso unico, preso ao PKCE. */
@Table({ tableName: 'oauth_codigos', underscored: true, timestamps: true })
export class OAuthCodigo extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  codigoHash: string;

  @ForeignKey(() => OAuthCliente)
  @Column({ type: DataType.UUID, allowNull: false })
  clienteId: string;

  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: false })
  usuarioId: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  redirectUri: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  codeChallenge: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  escopo: string | null;

  @Column({ type: DataType.DATE, allowNull: false })
  expiraEm: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  usadoEm: Date | null;

  @BelongsTo(() => OAuthCliente)
  cliente?: OAuthCliente;
}
