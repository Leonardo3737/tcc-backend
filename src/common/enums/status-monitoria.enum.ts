/**
 * Ciclo de vida da MONITORIA.
 *
 * PLANEJADA -> ATIVA -> ENCERRADA, com CANCELADA acessivel enquanto nao encerrada.
 * ENCERRADA e CANCELADA sao estados terminais: preservam o historico (RN10) em vez
 * de permitir que a monitoria seja apagada.
 */
export enum StatusMonitoria {
  PLANEJADA = 'PLANEJADA',
  ATIVA = 'ATIVA',
  ENCERRADA = 'ENCERRADA',
  CANCELADA = 'CANCELADA',
}
