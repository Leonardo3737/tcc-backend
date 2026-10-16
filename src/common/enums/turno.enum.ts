/**
 * Turno em que o candidato pretende atuar como monitor.
 *
 * Como `TipoNotificacao`, existe tambem como TIPO no PostgreSQL
 * (`enum_inscricoes_edital_turno`) em vez de `varchar` + CHECK. O nome segue a
 * convencao `enum_<tabela>_<coluna>` que o Sequelize assume ao gerar casts para
 * colunas ENUM; batizar diferente faria a aplicacao referenciar um tipo
 * inexistente em tempo de execucao.
 *
 * Nao e o turno do CURSO, e sim a disponibilidade declarada na candidatura: o
 * processo seletivo usa isso para distribuir monitores entre os turnos em que ha
 * demanda, e por isso o campo e filtravel na listagem da banca.
 */
export enum Turno {
  MATUTINO = 'MATUTINO',
  VESPERTINO = 'VESPERTINO',
  NOTURNO = 'NOTURNO',
}
