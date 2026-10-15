import { OrigemAtendimento } from '../../common/enums/origem-atendimento.enum';

/**
 * Contrato de eventos entre o nucleo e as notificacoes.
 *
 * Mesma forma ja usada por gamificacao/eventos.ts, e pelo mesmo motivo: o
 * nucleo emite e segue adiante, sem conhecer quem escuta. Remover o
 * NotificacoesModule do AppModule desliga os avisos sem quebrar compilacao nem
 * regra de negocio — os `emit` continuam acontecendo, sem ouvinte.
 *
 * Os eventos carregam IDs, nao entidades: o ouvinte busca o que precisar. Assim
 * o emissor nao precisa saber de que dados a notificacao depende.
 *
 * `historicoId` aparece nos eventos de transicao e NAO e decorativo: e ele que
 * serve de chave de idempotencia. Um atendimento pode ser reagendado mais de uma
 * vez, e usar o id do atendimento faria o segundo aviso ser descartado como
 * duplicata.
 */

export const EVENTO_ATENDIMENTO_AGENDADO = 'atendimento.agendado';
export const EVENTO_ATENDIMENTO_CANCELADO = 'atendimento.cancelado';
export const EVENTO_ATENDIMENTO_REAGENDADO = 'atendimento.reagendado';
export const EVENTO_MONITOR_HABILITADO = 'monitoria.monitor.habilitado';

export class AtendimentoAgendadoEvento {
  constructor(
    readonly atendimentoId: string,
    readonly monitoriaId: string,
    /** Define quem e avisado: o monitor (solicitacao) ou os monitorados (oferta). */
    readonly origem: OrigemAtendimento,
    /** Nao recebe aviso do proprio ato. */
    readonly autorUsuarioId: string,
    /**
     * A2 — quantas OUTRAS sessoes foram criadas no mesmo lote.
     *
     * Zero no agendamento avulso. Existe para que uma serie recorrente gere UM
     * aviso mencionando as demais, em vez de um por ocorrencia: 16 sessoes com
     * 20 monitorados seriam 320 e-mails de uma vez, o que queima a cota do
     * provedor e faz quem marcar spam derrubar a entrega do lembrete do dia.
     */
    readonly demaisSessoes = 0,
  ) {}
}

export class AtendimentoCanceladoEvento {
  constructor(
    readonly atendimentoId: string,
    readonly historicoId: string,
    readonly motivo: string,
    readonly autorUsuarioId: string,
    /**
     * Quem estava INSCRITO no instante do cancelamento.
     *
     * Vem no evento porque DEIXA DE EXISTIR: cancelar um atendimento tambem
     * cancela as inscricoes, para liberar a agenda dos alunos (a constraint
     * EXCLUDE so ignora quem esta fora de INSCRITO/PRESENTE). Quando o ouvinte
     * roda, ja nao ha nenhum `INSCRITO` para consultar — e sem esta lista o
     * aviso mais importante do sistema nao alcancaria exatamente quem precisa
     * dele.
     *
     * Sao ids de USUARIO (monitoria_participantes.aluno_id e a PK de alunos,
     * que por sua vez e a PK de usuarios — ver AD-03).
     */
    readonly inscritosUsuarioIds: string[],
  ) {}
}

export class AtendimentoReagendadoEvento {
  constructor(
    readonly atendimentoId: string,
    readonly historicoId: string,
    readonly autorUsuarioId: string,
  ) {}
}

export class MonitorHabilitadoEvento {
  constructor(
    /** Vinculo criado em monitoria_participantes. E a referencia do aviso. */
    readonly participanteId: string,
    readonly monitoriaId: string,
    readonly alunoUsuarioId: string,
    /**
     * Quantas inscricoes de MONITORADO foram canceladas ao promover.
     *
     * Zero na habilitacao comum, em que o aluno nao tinha vinculo anterior. Vem
     * no evento, e nao de consulta, porque o aviso precisa dizer o que MUDOU
     * para a pessoa — e, depois da transacao, uma inscricao cancelada por
     * promocao e indistinguivel de uma que ela mesma cancelou dias antes.
     *
     * Serve para que a promocao mande UM e-mail coerente em vez de dois
     * contraditorios ("voce virou monitor" + "seu atendimento foi cancelado").
     */
    readonly inscricoesCanceladas = 0,
  ) {}
}
