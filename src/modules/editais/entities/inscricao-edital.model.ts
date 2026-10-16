import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasOne,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

import { Turno } from '../../../common/enums/turno.enum';
import { Curso } from '../../cursos/entities/curso.model';
import { Disciplina } from '../../disciplinas/entities/disciplina.model';
import { Professor } from '../../usuarios/entities/professor.model';
import { Boletim } from './boletim.model';
import { Edital } from './edital.model';

/**
 * Candidatura a monitor em um edital.
 *
 * E a unica entidade do projeto que guarda dados de uma pessoa SEM conta:
 * `nomeCompleto`, `matricula` e `email` sao colunas, nao FK para `alunos`. A
 * ordem dos fatos exige isso — a conta do monitor e criada pelo professor
 * DEPOIS da aprovacao, e exigir cadastro para se candidatar inverteria o
 * processo. Criar inscricao nao cria linha em `alunos` nem em `usuarios`.
 *
 * Quando a matricula por acaso pertence a um aluno ja cadastrado, o vinculo e
 * resolvido na LEITURA (ver `InscricoesEditalService.alunosPorMatricula`), nao
 * gravado: um candidato que se cadastra depois da inscricao passaria a ser
 * reconhecido, o que uma coluna preenchida no momento do envio nunca faria.
 */
@Table({ tableName: 'inscricoes_edital', underscored: true, timestamps: true })
export class InscricaoEdital extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  override id: string;

  @ForeignKey(() => Edital)
  @Column({ type: DataType.UUID, allowNull: false })
  editalId: string;

  @Column({ type: DataType.STRING(150), allowNull: false })
  nomeCompleto: string;

  @Column({ type: DataType.STRING(30), allowNull: false })
  matricula: string;

  /** CITEXT: a UNIQUE por edital ignora a caixa, como em `usuarios.email`. */
  @Column({ type: DataType.CITEXT, allowNull: false })
  email: string;

  /**
   * Curso e disciplina do candidato.
   *
   * A compatibilidade entre os dois nao e checada so aqui: a FK composta
   * `(disciplina_id, curso_id) -> disciplina_cursos` recusa no banco qualquer
   * par que nao exista na associacao. O service valida antes apenas para
   * devolver mensagem de dominio em vez de erro de constraint.
   */
  @ForeignKey(() => Curso)
  @Column({ type: DataType.UUID, allowNull: false })
  cursoId: string;

  @ForeignKey(() => Disciplina)
  @Column({ type: DataType.UUID, allowNull: false })
  disciplinaId: string;

  /** Aponta para `professores.usuario_id` (PK = FK, AD-03). */
  @ForeignKey(() => Professor)
  @Column({ type: DataType.UUID, allowNull: false })
  professorId: string;

  @Column({ type: DataType.ENUM(...Object.values(Turno)), allowNull: false })
  turno: Turno;

  /**
   * DECIMAL(4,2), nulavel. O driver do PostgreSQL devolve `numeric` como
   * STRING para nao perder precisao em ponto flutuante — a conversao para
   * numero acontece no DTO de resposta, nao aqui.
   */
  @Column({ type: DataType.DECIMAL(4, 2), allowNull: true })
  n1: string | null;

  @Column({ type: DataType.DECIMAL(4, 2), allowNull: true })
  n2: string | null;

  /**
   * SOMENTE LEITURA. E uma coluna GENERATED ALWAYS AS round((n1+n2)/2, 2)
   * STORED no PostgreSQL.
   *
   * Nunca atribua valor a esta propriedade: o banco recusa INSERT ou UPDATE que
   * mencione uma coluna gerada, e a requisicao falharia com erro de sintaxe do
   * driver em vez de uma mensagem util. Nada no codigo escreve aqui — e o que
   * garante que a media nao pode ser definida pelo cliente.
   *
   * Nula quando n1 ou n2 e nula: aritmetica com NULL e NULL em SQL, entao a
   * ausencia de nota nunca vira zero.
   */
  @Column({ type: DataType.DECIMAL(4, 2), allowNull: true })
  media: string | null;

  @BelongsTo(() => Edital)
  edital?: Edital;

  @BelongsTo(() => Curso)
  curso?: Curso;

  @BelongsTo(() => Disciplina)
  disciplina?: Disciplina;

  @BelongsTo(() => Professor)
  professor?: Professor;

  /**
   * O PDF vive em tabela separada e NAO entra em nenhuma consulta de listagem.
   * Ver o cabecalho de `Boletim`.
   */
  @HasOne(() => Boletim)
  boletim?: Boletim;

  declare createdAt: Date;
  declare updatedAt: Date;
}
