import { Column, DataType, Default, HasMany, Model, PrimaryKey, Table } from 'sequelize-typescript';

import { InscricaoEdital } from './inscricao-edital.model';

/**
 * Edital de selecao de monitores.
 *
 * Periodo de inscricoes, link do documento oficial e o periodo academico a que
 * se refere. Nao guarda vagas, etapas nem resultado: nada no escopo atual
 * precisa disso, e campo de status inventado aqui seria estado que ninguem
 * atualiza.
 *
 * As datas sao DATEONLY (`date` no banco) de proposito — "inscricoes de 10/11 a
 * 25/11" e uma afirmacao sobre dias do calendario local, nao sobre instantes.
 * Quem decide se hoje esta no periodo e o PostgreSQL, com AT TIME ZONE sobre o
 * fuso da instituicao; ver `EditaisService.dataDeHoje`.
 */
@Table({ tableName: 'editais', underscored: true, timestamps: true })
export class Edital extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  /**
   * DATEONLY chega como string 'YYYY-MM-DD', e nao como Date. Isso e desejado:
   * converter para Date aqui reintroduziria o fuso do processo Node na conta
   * que o banco acabou de fazer sem ele.
   */
  @Column({ type: DataType.DATEONLY, allowNull: false })
  inicioInscricoes: string;

  @Column({ type: DataType.DATEONLY, allowNull: false })
  fimInscricoes: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  link: string;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  ano: number;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  semestre: number;

  /**
   * Exclusao LOGICA. `DELETE /editais/:id` apenas desliga este campo.
   *
   * Apagar a linha nao e opcao: o edital e o contexto de candidaturas ja
   * recebidas, e a FK em `inscricoes_edital` e RESTRICT. Mesmo mecanismo de
   * `cursos.ativo` e `disciplinas.ativa` (RN10).
   */
  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  ativo: boolean;

  @HasMany(() => InscricaoEdital)
  inscricoes?: InscricaoEdital[];

  declare createdAt: Date;
  declare updatedAt: Date;
}
