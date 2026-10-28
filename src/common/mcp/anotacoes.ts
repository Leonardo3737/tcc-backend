import { ToolAnnotations } from '@rekog/mcp-nest';

/**
 * Anotacoes padrao das ferramentas MCP.
 *
 * Sao dicas que o cliente usa para decidir o que pode chamar sozinho e o que
 * precisa confirmar com o usuario. Ficam centralizadas porque o erro tipico e
 * marcar uma escrita como `readOnlyHint: true` ao copiar a ferramenta anterior
 * — e ai o cliente deixa de pedir confirmacao para uma operacao que grava.
 *
 * `destructiveHint` e FALSO em todas: pela RN10 o sistema nao apaga registro
 * nenhum. Cancelar, encerrar e remover sao mudancas de situacao, e o historico
 * permanece consultavel.
 */

/** Consulta: nao grava nada. */
export const LEITURA: ToolAnnotations = { readOnlyHint: true };

/** Criacao ou alteracao de dados. Repetir cria/altera de novo. */
export const ESCRITA: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
};

/**
 * Mudanca de situacao governada por maquina de estados (ativar, encerrar,
 * cancelar, realizar). Repetir NAO repete o efeito: a segunda chamada e
 * recusada porque a transicao deixou de ser valida.
 */
export const TRANSICAO: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
};
