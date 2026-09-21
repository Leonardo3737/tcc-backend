/**
 * Perfis de IDENTIDADE do sistema.
 *
 * Atencao: MONITOR e MONITORADO NAO entram aqui e nunca entrarao.
 * Eles sao papeis CONTEXTUAIS, assumidos por um ALUNO dentro de uma MONITORIA
 * especifica, e serao representados na fase 2 como a coluna `papel` da entidade
 * MONITORIA_PARTICIPANTE. Ver secao 9 de docs/arquitetura.md.
 *
 * Um mesmo usuario pode acumular mais de um perfil (ex.: pos-graduando que e
 * aluno e professor), por isso o token carrega uma LISTA de perfis. O perfil nao
 * e uma coluna de `usuarios`: ele e derivado da existencia das linhas em
 * `alunos` / `professores`.
 */
export enum PerfilUsuario {
  ALUNO = 'ALUNO',
  PROFESSOR = 'PROFESSOR',
}
