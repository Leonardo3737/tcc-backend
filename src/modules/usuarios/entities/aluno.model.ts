import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';

import { Curso } from '../../cursos/entities/curso.model';
import { Usuario } from './usuario.model';

/**
 * Especializacao 1:1 de USUARIO (AD-03).
 *
 * A PK e a propria FK para `usuarios`, o que torna a cardinalidade 1:0..1
 * impossivel de violar: nao existe aluno sem usuario, nem dois alunos para o
 * mesmo usuario. A existencia desta linha E o que da ao usuario o perfil ALUNO.
 */
@Table({ tableName: 'alunos', underscored: true, timestamps: true })
export class Aluno extends Model {
  @PrimaryKey
  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, field: 'usuario_id' })
  usuarioId: string;

  @Unique
  @Column({ type: DataType.STRING(30), allowNull: false })
  matricula: string;

  /**
   * Curso do aluno. Substituiu o antigo campo de texto livre.
   *
   * E o que decide de quais monitorias ele pode participar: as FKs compostas em
   * `monitoria_participantes` exigem que este curso coincida com o da
   * disciplina da monitoria. Por isso trocar de curso e bloqueado enquanto
   * existir participacao registrada — inclusive encerrada, ja que a RN10
   * preserva historico e reescreve-lo afirmaria que uma monitoria ocorreu em um
   * curso em que ela nao ocorreu.
   */
  @ForeignKey(() => Curso)
  @Column({ type: DataType.UUID, allowNull: false })
  cursoId: string;

  @BelongsTo(() => Curso)
  curso?: Curso;

  @BelongsTo(() => Usuario)
  usuario?: Usuario;

  /** Gerenciados pelo Sequelize (timestamps: true) -> colunas created_at / updated_at. */
  declare createdAt: Date;
  declare updatedAt: Date;
}
