/**
 * Contrato de eventos entre o nucleo do dominio e a gamificacao.
 *
 * Este arquivo e a UNICA superficie compartilhada. Atendimentos e Avaliacoes
 * emitem; Gamificacao escuta. Nenhum dos dois lados importa o service do outro,
 * entao a gamificacao pode ser removida, substituida ou desligada sem tocar em
 * uma linha do nucleo — que era o requisito de nao acoplar demais.
 *
 * Os eventos carregam IDs, nao entidades: o ouvinte busca o que precisar. Assim
 * o emissor nao precisa saber do que a gamificacao depende.
 */

export const EVENTO_ATENDIMENTO_REALIZADO = 'atendimento.realizado';
export const EVENTO_AVALIACAO_REGISTRADA = 'avaliacao.registrada';

export class AtendimentoRealizadoEvento {
  constructor(
    readonly atendimentoId: string,
    readonly monitoriaId: string,
    readonly monitorParticipanteId: string,
    /** Vinculos dos monitorados com presenca confirmada. */
    readonly presentesParticipanteIds: string[],
  ) {}
}

export class AvaliacaoRegistradaEvento {
  constructor(
    readonly avaliacaoId: string,
    readonly monitoriaId: string,
    readonly monitorParticipanteId: string,
    readonly nota: number,
  ) {}
}
