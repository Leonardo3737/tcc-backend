import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

import { StatusMonitoria } from '../../../common/enums/status-monitoria.enum';
import { Disciplina } from '../../disciplinas/entities/disciplina.model';
import { Professor } from '../../usuarios/entities/professor.model';
import { MonitoriaParticipante } from './monitoria-participante.model';

/**
 * O agregado central: oferta de apoio academico de uma disciplina, em um
 * periodo, sob responsabilidade de um professor.
 */
@Table({ tableName: 'monitorias', underscored: true, timestamps: true })
export class Monitoria extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Disciplina)
  @Column({ type: DataType.UUID, allowNull: false })
  disciplinaId: string;

  @ForeignKey(() => Professor)
  @Column({ type: DataType.UUID, allowNull: false })
  professorId: string;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  ano: number;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  semestre: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  descricao: string | null;

  /**
   * PROCEDENCIA opcional: o edital que originou esta monitoria.
   *
   * Nula na maioria dos casos, e isso nao e falta de dado — e o que significa
   * "criada a mao, fora de processo seletivo", que continua sendo um caminho
   * valido (`POST /monitorias`). Preenchida, diz que a monitoria nasceu da
   * aprovacao de uma candidatura, e e o que permite a banca ver, no resumo do
   * edital, de quais disciplinas ela ja cadastrou monitoria.
   *
   * Nao ha associacao `@BelongsTo` aqui de proposito: nada precisa carregar o
   * edital junto da monitoria, e declarar o lado inverso em `Edital` fecharia um
   * ciclo de import entre os dois modulos sem nenhum consumidor.
   */
  @Column({ type: DataType.UUID, allowNull: true })
  editalId: string | null;

  @Default(StatusMonitoria.PLANEJADA)
  @Column({ type: DataType.STRING(20), allowNull: false })
  status: StatusMonitoria;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  dataInicio: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  dataFim: string | null;

  @BelongsTo(() => Disciplina)
  disciplina?: Disciplina;

  @BelongsTo(() => Professor)
  professor?: Professor;

  @HasMany(() => MonitoriaParticipante)
  participantes?: MonitoriaParticipante[];

  declare createdAt: Date;
  declare updatedAt: Date;
}
