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

  @Column({ type: DataType.STRING(120), allowNull: true })
  curso: string | null;

  @BelongsTo(() => Usuario)
  usuario?: Usuario;

  /** Gerenciados pelo Sequelize (timestamps: true) -> colunas created_at / updated_at. */
  declare createdAt: Date;
  declare updatedAt: Date;
}
