import {
  BelongsToMany,
  Column,
  DataType,
  Default,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';

import { Curso } from '../../cursos/entities/curso.model';
import { DisciplinaCurso } from './disciplina-curso.model';
import { Monitoria } from '../../monitorias/entities/monitoria.model';

/**
 * Catalogo minimo. A disciplina existe para dar identidade a monitoria —
 * nao para modelar a estrutura academica da instituicao.
 */
@Table({ tableName: 'disciplinas', underscored: true, timestamps: true })
export class Disciplina extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  /** CITEXT: "mat101" e "MAT101" sao o mesmo codigo para a constraint UNIQUE. */
  @Unique
  @Column({ type: DataType.CITEXT, allowNull: false })
  codigo: string;

  @Column({ type: DataType.STRING(150), allowNull: false })
  nome: string;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  ativa: boolean;

  /**
   * Cursos que oferecem esta disciplina. Pelo menos um.
   *
   * Define quem pode participar das monitorias dela: so alunos de algum destes
   * cursos. A garantia nao e desta associacao em si, e sim da FK composta que
   * aponta de `monitoria_participantes (disciplina_id, curso_id)` para a chave
   * primaria de `disciplina_cursos`.
   */
  @BelongsToMany(() => Curso, () => DisciplinaCurso)
  cursos?: Curso[];

  @HasMany(() => Monitoria)
  monitorias?: Monitoria[];

  declare createdAt: Date;
  declare updatedAt: Date;
}
