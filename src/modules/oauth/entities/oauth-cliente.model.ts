import { Column, DataType, Default, Model, PrimaryKey, Table } from 'sequelize-typescript';

/**
 * Um cliente OAuth registrado via Dynamic Client Registration (RFC 7591).
 *
 * Na pratica, cada conexao do Claude (web, desktop, Claude Code) se registra
 * sozinha. O `id` e o `client_id`. Nao ha segredo: o cliente e PUBLICO e a
 * seguranca do fluxo vem do PKCE.
 */
@Table({ tableName: 'oauth_clientes', underscored: true, timestamps: true })
export class OAuthCliente extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @Column({ type: DataType.STRING(200), allowNull: true })
  nome: string | null;

  @Column({ type: DataType.ARRAY(DataType.TEXT), allowNull: false })
  redirectUris: string[];
}
