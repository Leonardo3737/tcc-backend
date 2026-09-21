/**
 * O papel do ALUNO DENTRO de uma monitoria especifica.
 *
 * Este e o enum que materializa a decisao central do dominio: MONITOR e
 * MONITORADO nao sao tipos de usuario, sao atributos da relacao entre ALUNO e
 * MONITORIA. O mesmo aluno pode ser MONITOR em Calculo I e MONITORADO em Banco
 * de Dados — sao duas linhas de monitoria_participantes, nao dois usuarios.
 *
 * RN09 (nao acumular papeis na mesma monitoria) e garantida por indice unico
 * parcial no banco, nao por codigo.
 */
export enum PapelMonitoria {
  MONITOR = 'MONITOR',
  MONITORADO = 'MONITORADO',
}
