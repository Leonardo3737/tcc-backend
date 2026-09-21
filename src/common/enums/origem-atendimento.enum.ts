/**
 * Quem iniciou o atendimento (D-08: ambos podem).
 *
 * Registrar a origem evita duplicar a maquina de estados: os dois caminhos
 * convergem para AGENDADO, e a diferenca fica sendo apenas um dado historico.
 */
export enum OrigemAtendimento {
  SOLICITACAO_ALUNO = 'SOLICITACAO_ALUNO',
  OFERTA_MONITOR = 'OFERTA_MONITOR',
}
