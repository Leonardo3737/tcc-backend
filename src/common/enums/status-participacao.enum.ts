/**
 * Situacao do vinculo do aluno com a monitoria.
 *
 * Sair de uma monitoria e ENCERRAR o vinculo, nunca apagar a linha (RN10):
 * atendimentos passados continuam apontando para o participante correto da epoca.
 * Trocar de papel tambem passa por aqui — encerra-se o vinculo antigo e cria-se
 * um novo, o que mantem o historico intacto.
 */
export enum StatusParticipacao {
  ATIVO = 'ATIVO',
  ENCERRADO = 'ENCERRADO',
}
