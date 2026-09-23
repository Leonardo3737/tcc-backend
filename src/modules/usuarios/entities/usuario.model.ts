import {
  Column,
  DataType,
  Default,
  DefaultScope,
  ForeignKey,
  HasOne,
  Model,
  PrimaryKey,
  Scopes,
  Table,
  Unique,
} from 'sequelize-typescript';

import { Aluno } from './aluno.model';
import { Professor } from './professor.model';

/**
 * Escopo padrao remove `senhaHash` de TODA consulta.
 *
 * Isso e uma defesa estrutural: mesmo que alguem esqueca de filtrar atributos em
 * um controller novo, o hash nao vaza. Quem precisa do hash (apenas o login)
 * pede explicitamente `Usuario.scope('comSenha')`.
 */
@DefaultScope(() => ({
  attributes: { exclude: ['senhaHash'] },
}))
@Scopes(() => ({
  /** Unico escopo que expoe o hash. Usado apenas na autenticacao. */
  comSenha: {},
  /**
   * Carrega as especializacoes para derivar os perfis do usuario.
   * A exclusao de `senhaHash` e repetida de proposito: chamar .scope() SUBSTITUI
   * o defaultScope em vez de somar a ele, entao omitir isso aqui reabriria o
   * vazamento que o defaultScope fecha.
   */
  comPerfis: {
    attributes: { exclude: ['senhaHash'] },
    include: [Aluno, Professor],
  },
}))
@Table({ tableName: 'usuarios', underscored: true, timestamps: true })
export class Usuario extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @Column({ type: DataType.STRING(150), allowNull: false })
  nome: string;

  /**
   * CITEXT: comparacao case-insensitive feita pelo proprio PostgreSQL.
   * "Joao@ufx.br" e "joao@ufx.br" sao o mesmo usuario, e a constraint UNIQUE
   * garante isso no banco — nao depende de lembrarmos de normalizar no codigo.
   */
  @Unique
  @Column({ type: DataType.CITEXT, allowNull: false })
  email: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'senha_hash' })
  senhaHash: string;

  /** Desativacao logica. Nunca removemos usuarios (RN10). */
  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  ativo: boolean;

  /**
   * Quem criou esta conta. NULL = auto-cadastro em /auth/registro/*.
   *
   * Preenchido quando um PROFESSOR cria a conta administrativamente. Como nao ha
   * perfil ADMIN, professores expandem o proprio conjunto — e essa coluna e o
   * que torna isso auditavel.
   */
  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: true })
  criadoPorUsuarioId: string | null;

  @HasOne(() => Aluno)
  aluno?: Aluno;

  @HasOne(() => Professor)
  professor?: Professor;

  /** Gerenciados pelo Sequelize (timestamps: true) -> colunas created_at / updated_at. */
  declare createdAt: Date;
  declare updatedAt: Date;
}
