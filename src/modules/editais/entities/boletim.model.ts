import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

import { InscricaoEdital } from './inscricao-edital.model';

/**
 * PDF do boletim de notas do candidato, em BYTEA.
 *
 * Tabela SEPARADA de `inscricoes_edital`, e esse e o ponto todo da decisao: a
 * listagem da banca pagina candidaturas e nunca precisa dos bytes. Se o binario
 * morasse na mesma linha, qualquer consulta que nao enumerasse colunas — o
 * `SELECT` que o ORM monta por padrao, inclusive — arrastaria megabytes por
 * pagina. Aqui ele so e lido por quem faz o JOIN de proposito: uma unica rota,
 * autenticada, que entrega um arquivo.
 *
 * PK = FK (`inscricaoId`), como `alunos` e `professores` sobre `usuarios`
 * (AD-03): nao existe boletim sem candidatura nem dois para a mesma.
 *
 * `conteudo` NAO e declarado neste model por engano de omissao — ele esta aqui,
 * mas toda consulta de metadado precisa pedir `attributes` explicitos. Ver
 * `InscricoesEditalService.metadadoDoBoletim`, que e a leitura usada pelas
 * respostas de API, e `conteudoDoBoletim`, a unica que traz os bytes.
 */
@Table({ tableName: 'boletins', underscored: true, timestamps: true, updatedAt: false })
export class Boletim extends Model {
  @PrimaryKey
  @ForeignKey(() => InscricaoEdital)
  @Column({ type: DataType.UUID, field: 'inscricao_id' })
  inscricaoId: string;

  /** BLOB -> BYTEA no PostgreSQL. Chega como Buffer. */
  @Column({ type: DataType.BLOB, allowNull: false })
  conteudo: Buffer;

  /** Nome informado no upload, ja sanitizado (ver `nomeSeguroDeArquivo`). */
  @Column({ type: DataType.STRING(255), allowNull: false })
  nomeOriginal: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  tamanhoBytes: number;

  /**
   * SHA-256 hexadecimal minusculo do conteudo.
   *
   * Serve para detectar corrupcao e para reconhecer o mesmo arquivo enviado por
   * candidatos diferentes — nao e mecanismo de seguranca.
   */
  @Column({ type: DataType.CHAR(64), allowNull: false })
  sha256: string;

  @BelongsTo(() => InscricaoEdital)
  inscricao?: InscricaoEdital;

  declare createdAt: Date;
}
