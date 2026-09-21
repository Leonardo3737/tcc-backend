/**
 * Situacao de UM monitorado dentro de um atendimento.
 *
 * Como o atendimento pode ser coletivo (D-03), a presenca e por pessoa: um aluno
 * pode faltar sem que a sessao inteira deixe de ter sido realizada. E por isso
 * que "nao compareceu" vive aqui, e nao em StatusAtendimento.
 */
export enum StatusInscricao {
  INSCRITO = 'INSCRITO',
  PRESENTE = 'PRESENTE',
  AUSENTE = 'AUSENTE',
  CANCELADA = 'CANCELADA',
}
