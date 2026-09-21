/**
 * Tipos de evento que geram pontos.
 *
 * Enum pequeno de proposito: a gamificacao desta versao e "atendimento concluido
 * -> pontuacao -> ranking". Badges, niveis e recompensas nao entram aqui — quando
 * entrarem, serao REGRAS que leem estes eventos, nao novos tipos de evento.
 */
export enum TipoPontuacao {
  /** Monitor conduziu uma sessao ate o fim. */
  ATENDIMENTO_REALIZADO = 'ATENDIMENTO_REALIZADO',
  /** Monitorado compareceu a uma sessao. */
  PARTICIPACAO_ATENDIMENTO = 'PARTICIPACAO_ATENDIMENTO',
  /** Monitor recebeu uma avaliacao — pontos proporcionais a nota. */
  AVALIACAO_RECEBIDA = 'AVALIACAO_RECEBIDA',
}
