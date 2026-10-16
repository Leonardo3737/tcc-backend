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

import { Aluno } from '../../usuarios/entities/aluno.model';
import { Disciplina } from '../../disciplinas/entities/disciplina.model';
import { DisciplinaCurso } from '../../disciplinas/entities/disciplina-curso.model';

/**
 * Catalogo de cursos. Mesma forma de Disciplina: nome livre, codigo gerado.
 *
 * E o topo da cadeia que sustenta a regra de que um aluno so participa de
 * monitoria da propria area: disciplina pertence a um curso, aluno pertence a
 * um curso, e as FKs compostas em `monitorias` e `monitoria_participantes`
 * exigem que os dois coincidam (ver a migration 20261016100000).
 */
@Table({ tableName: 'cursos', underscored: true, timestamps: true })
export class Curso extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  /** CITEXT: "eng001" e "ENG001" sao o mesmo codigo para a constraint UNIQUE. */
  @Unique
  @Column({ type: DataType.CITEXT, allowNull: false })
  codigo: string;

  @Column({ type: DataType.STRING(150), allowNull: false })
  nome: string;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  ativo: boolean;

  @BelongsToMany(() => Disciplina, () => DisciplinaCurso)
  disciplinas?: Disciplina[];

  @HasMany(() => Aluno)
  alunos?: Aluno[];

  declare createdAt: Date;
  declare updatedAt: Date;
}
