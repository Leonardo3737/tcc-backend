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
 * Mesmo padrao de ALUNO: PK = FK. A existencia desta linha E o que da ao usuario
 * o perfil PROFESSOR — e, na fase 2, o que permite a ele ser responsavel por uma
 * MONITORIA e habilitar monitores (RN01).
 */
@Table({ tableName: 'professores', underscored: true, timestamps: true })
export class Professor extends Model {
  @PrimaryKey
  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, field: 'usuario_id' })
  usuarioId: string;

  /** SIAPE ou matricula funcional. Opcional: nem toda instituicao expoe. */
  @Unique
  @Column({ type: DataType.STRING(30), allowNull: true, field: 'identificacao_funcional' })
  identificacaoFuncional: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  departamento: string | null;

  @BelongsTo(() => Usuario)
  usuario?: Usuario;

  /** Gerenciados pelo Sequelize (timestamps: true) -> colunas created_at / updated_at. */
  declare createdAt: Date;
  declare updatedAt: Date;
}
