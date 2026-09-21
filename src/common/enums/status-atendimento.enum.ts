/**
 * Ciclo de vida do ATENDIMENTO (a sessao).
 *
 * AGENDADO -> REALIZADO, ou AGENDADO -> CANCELADO. Sao estados terminais:
 * atendimento nunca e removido do banco (RN10). Cada transicao gera uma linha em
 * atendimento_status_historico.
 *
 * Nota de consistencia com docs/arquitetura.md: o documento previa
 * SOLICITADO -> CONFIRMADO -> CONCLUIDO, com uma etapa de confirmacao do monitor
 * para solicitacoes de aluno (D-08). O ciclo de tres estados definido para esta
 * fase elimina essa etapa: uma solicitacao de aluno ja nasce AGENDADA. A coluna
 * `origem` continua registrando quem iniciou, entao reintroduzir a confirmacao
 * depois nao exige mudanca estrutural.
 */
export enum StatusAtendimento {
  AGENDADO = 'AGENDADO',
  REALIZADO = 'REALIZADO',
  CANCELADO = 'CANCELADO',
}
