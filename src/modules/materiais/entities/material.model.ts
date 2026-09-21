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

import { TipoMaterial } from '../../../common/enums/tipo-material.enum';
import { Monitoria } from '../../monitorias/entities/monitoria.model';
import { Usuario } from '../../usuarios/entities/usuario.model';

/**
 * Material de apoio de uma monitoria.
 *
 * As colunas `arquivo*` existem no schema mas nao sao usadas nesta versao: o
 * material e um LINK. Ver a nota de escopo no README.
 */
@Table({ tableName: 'materiais', underscored: true, timestamps: true })
export class Material extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Monitoria)
  @Column({ type: DataType.UUID, allowNull: false })
  monitoriaId: string;

  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: false })
  autorUsuarioId: string;

  @Column({ type: DataType.STRING(150), allowNull: false })
  titulo: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  descricao: string | null;

  @Default(TipoMaterial.LINK)
  @Column({ type: DataType.STRING(20), allowNull: false })
  tipo: TipoMaterial;

  @Column({ type: DataType.TEXT, allowNull: true })
  url: string | null;

  /** Soft delete: remover nao apaga a linha (RN10). */
  @Column({ type: DataType.DATE, allowNull: true })
  removidoEm: Date | null;

  @ForeignKey(() => Usuario)
  @Column({ type: DataType.UUID, allowNull: true })
  removidoPorUsuarioId: string | null;

  @BelongsTo(() => Monitoria)
  monitoria?: Monitoria;

  @BelongsTo(() => Usuario, 'autorUsuarioId')
  autor?: Usuario;

  declare createdAt: Date;
  declare updatedAt: Date;
}
