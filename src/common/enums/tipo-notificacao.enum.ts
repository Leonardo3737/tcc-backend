/**
 * Tipos de notificacao por e-mail.
 *
 * Diferente dos demais enums do projeto, este existe tambem como TIPO no
 * PostgreSQL (`enum_notificacoes_tipo`), e nao como `varchar` + CHECK. Isso foi
 * pedido explicitamente; vale saber o que muda: acrescentar um tipo passa a
 * exigir `ALTER TYPE ... ADD VALUE` em migration, e REMOVER um tipo exige
 * recriar o tipo inteiro. Com CHECK bastaria trocar a constraint.
 *
 * O nome do tipo no banco segue a convencao do Sequelize
 * (`enum_<tabela>_<coluna>`) de proposito: e o nome que o ORM assume ao gerar
 * casts para colunas ENUM. Batizar diferente faria a aplicacao referenciar um
 * tipo inexistente em tempo de execucao.
 *
 * Criterio para um tipo existir: a pessoa precisa FAZER algo diferente por ter
 * recebido. Aviso que nao muda comportamento vira ruido, e ruido em e-mail
 * transacional tem custo — quem marca como spam derruba a entrega do que
 * importa.
 */
export enum TipoNotificacao {
  /** Agendado para hoje. Disparado por rotina, nao por evento. */
  LEMBRETE_DIA = 'LEMBRETE_DIA',

  /** O atendimento nao vai acontecer. Sem isto a pessoa se desloca a toa. */
  ATENDIMENTO_CANCELADO = 'ATENDIMENTO_CANCELADO',

  /**
   * O horario mudou e a inscricao foi preservada (B5) — ou seja, a pessoa
   * continua inscrita em um horario que ela nao escolheu e nao conhece.
   */
  ATENDIMENTO_REAGENDADO = 'ATENDIMENTO_REAGENDADO',

  /** RN01: o aluno virou MONITOR por ato do professor e passa a ter deveres. */
  MONITOR_HABILITADO = 'MONITOR_HABILITADO',

  /** Um monitorado solicitou atendimento: o monitor tem compromisso novo. */
  ATENDIMENTO_SOLICITADO = 'ATENDIMENTO_SOLICITADO',

  /** O monitor abriu sessao com vagas. E o que faz a oferta circular. */
  ATENDIMENTO_OFERTADO = 'ATENDIMENTO_OFERTADO',

  /** Fecha o ciclo da RN05/RN06, que hoje depende de o aluno lembrar sozinho. */
  AVALIACAO_PENDENTE = 'AVALIACAO_PENDENTE',
}
