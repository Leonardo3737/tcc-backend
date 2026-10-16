import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

import { Curso } from '../../cursos/entities/curso.model';
import { Disciplina } from './disciplina.model';

/**
 * Associacao N:M entre disciplina e curso.
 *
 * "Banco de Dados" e disciplina de Sistemas de Informacao E de Engenharia da
 * Computacao: a mesma disciplina, um cadastro so, varios cursos.
 *
 * Nao e tabela de apoio passiva. Sua chave primaria composta
 * (disciplina_id, curso_id) e o ALVO da FK que sustenta a regra de
 * elegibilidade: um vinculo de monitoria so existe se o par formado pela
 * disciplina da monitoria e pelo curso do aluno estiver aqui.
 */
@Table({ tableName: 'disciplina_cursos', underscored: true, timestamps: false })
export class DisciplinaCurso extends Model {
  @ForeignKey(() => Disciplina)
  @Column({ type: DataType.UUID, primaryKey: true })
  disciplinaId: string;

  @ForeignKey(() => Curso)
  @Column({ type: DataType.UUID, primaryKey: true })
  cursoId: string;

  /**
   * `created_at` existe na tabela, com default do banco, mas nao e declarada
   * aqui: nada no codigo a consome, e com `timestamps: false` o Sequelize
   * mapearia `criadoEm` para `criado_em`, que nao e o nome da coluna.
   */
}
