import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { TipoNotificacao } from '../../common/enums/tipo-notificacao.enum';

/**
 * Montagem das mensagens. Funcoes puras, testaveis sem banco e sem rede.
 *
 * Estao separadas do service de proposito: a formatacao de data no fuso da
 * instituicao e a parte com maior chance de erro silencioso de todo o modulo, e
 * um aviso com o horario errado e pior que aviso nenhum.
 */

export interface DadosDoAtendimento {
  disciplina: string;
  inicio: Date;
  fim: Date;
  modalidade: string;
  local: string | null;
  monitor: string;
}

/**
 * Data e hora no fuso da INSTITUICAO, nunca no do servidor.
 *
 * O servidor pode rodar em UTC, em container com outro fuso, ou na maquina de
 * quem desenvolve. O horario que a pessoa vai ler precisa ser o mesmo que ela
 * veria na tela do sistema — e a tela usa o fuso institucional. Intl com
 * `timeZone` explicito e o que garante isso sem depender do ambiente.
 */
export function formatarDataHora(data: Date, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(data);
}

export function formatarHora(data: Date, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    hour: '2-digit',
    minute: '2-digit',
  }).format(data);
}

/**
 * Bloco comum a todo aviso sobre um atendimento.
 *
 * `incluirMonitor` existe para o unico caso em que a linha atrapalha: quando
 * quem le E o monitor. "Monitor(a): Ana Monitora" num e-mail enderecado a Ana
 * nao informa nada e denuncia uma mensagem escrita para outra pessoa.
 */
function blocoDoAtendimento(
  dados: DadosDoAtendimento,
  fuso: string,
  incluirMonitor = true,
): string[] {
  const linhas = [
    `Disciplina: ${dados.disciplina}`,
    `Quando: ${formatarDataHora(dados.inicio, fuso)} às ${formatarHora(dados.fim, fuso)}`,
    ...(incluirMonitor ? [`Monitor(a): ${dados.monitor}`] : []),
    `Modalidade: ${dados.modalidade}`,
  ];

  if (dados.local) {
    linhas.push(`Local: ${dados.local}`);
  }

  return linhas;
}

export interface Mensagem {
  assunto: string;
  corpo: string;
}

export interface ReferenciasDeLink {
  atendimentoId?: string;
  monitoriaId?: string;
}

/**
 * Caminho no frontend por tipo de aviso.
 *
 * Quase todo aviso leva a pagina do ATENDIMENTO, porque e la que esta a acao
 * que ele pede — inscrever-se, avaliar, conferir o novo horario. A habilitacao
 * de monitor e a excecao: ela nao fala de atendimento nenhum, e o destino util
 * e a monitoria em que a pessoa acabou de virar monitora.
 *
 * O caminho do aviso de cancelamento tambem aponta para o atendimento, e isso
 * funciona porque nada e apagado nesta API (RN10): o atendimento cancelado
 * continua existindo e consultavel.
 */
const CAMINHOS: Record<TipoNotificacao, (referencias: ReferenciasDeLink) => string | null> = {
  [TipoNotificacao.LEMBRETE_DIA]: (r) => caminhoDoAtendimento(r),
  [TipoNotificacao.ATENDIMENTO_CANCELADO]: (r) => caminhoDoAtendimento(r),
  [TipoNotificacao.ATENDIMENTO_REAGENDADO]: (r) => caminhoDoAtendimento(r),
  [TipoNotificacao.ATENDIMENTO_SOLICITADO]: (r) => caminhoDoAtendimento(r),
  [TipoNotificacao.ATENDIMENTO_OFERTADO]: (r) => caminhoDoAtendimento(r),
  [TipoNotificacao.AVALIACAO_PENDENTE]: (r) => caminhoDoAtendimento(r),
  [TipoNotificacao.MONITOR_HABILITADO]: (r) =>
    r.monitoriaId ? `/monitorias/${r.monitoriaId}` : null,
};

function caminhoDoAtendimento(referencias: ReferenciasDeLink): string | null {
  return referencias.atendimentoId ? `/atendimentos/${referencias.atendimentoId}` : null;
}

/**
 * Monta o link que vai no corpo do e-mail.
 *
 * Sem o id esperado, cai na raiz do sistema em vez de produzir uma URL quebrada
 * do tipo `/atendimentos/undefined` — um link quebrado em e-mail nao tem
 * conserto depois de enviado.
 *
 * A barra final da base e removida aqui, e nao so na configuracao, para que a
 * funcao seja correta por si — ela e testada isolada e usada por quem nao
 * necessariamente passou pelo ConfigService.
 */
export function montarLink(
  tipo: TipoNotificacao,
  referencias: ReferenciasDeLink,
  urlBase: string,
): string {
  const base = urlBase.replace(/\/+$/, '');
  return `${base}${CAMINHOS[tipo](referencias) ?? ''}`;
}

/** Tudo que um texto de aviso precisa saber. */
export interface ContextoDaMensagem {
  nome: string;
  dados: DadosDoAtendimento;
  fuso: string;
  /** Ja pronto: a regra de URL mora em `montarLink`, nao nos textos. */
  link: string;
  motivo?: string;

  /**
   * Papel de QUEM RECEBE, nao de quem conduz.
   *
   * O mesmo aviso chega aos dois lados do atendimento, e eles precisam de
   * coisas diferentes: o monitorado precisa saber onde comparecer e como
   * desistir; o monitor precisa saber quantas pessoas esperar e que mexer no
   * horario avisa todo mundo. Nao viraram dois tipos no enum porque e o mesmo
   * fato — e a chave de idempotencia ja separa por usuario.
   */
  papel?: PapelMonitoria;

  /** Quantos monitorados confirmados. So interessa ao monitor. */
  inscritos?: number;

  /**
   * Inscricoes canceladas pela promocao a monitor (A3).
   *
   * Zero na habilitacao comum. Quando ha, o texto precisa explicar a causa
   * junto com o efeito — senao a pessoa recebe "voce virou monitor" e descobre
   * sozinha, depois, que perdeu as vagas que tinha.
   */
  inscricoesCanceladas?: number;

  /**
   * Outras sessoes criadas no mesmo lote (A2). Zero no agendamento avulso.
   *
   * O lote emite UM evento para a serie inteira; este numero e o que permite a
   * mensagem dizer "e mais N sessoes" em vez de o monitorado receber um e-mail
   * por ocorrencia.
   */
  demaisSessoes?: number;
}

/**
 * Lembrete para quem VAI SER ATENDIDO.
 *
 * Mantem a linha "Monitor(a)", que para o monitorado e informacao util, e
 * fecha com a instrucao que lhe cabe: desistir libera a vaga para outro.
 */
function lembreteDoMonitorado({ nome, dados, fuso, link }: ContextoDaMensagem): Mensagem {
  return {
    assunto: `Lembrete: você tem atendimento hoje (${dados.disciplina})`,
    corpo: [
      `Olá, ${nome}.`,
      '',
      'Você tem um atendimento de monitoria HOJE:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      '',
      'Se não puder comparecer, cancele sua inscrição para liberar a vaga.',
      ...acesse('Ver atendimento', link),
    ].join('\n'),
  };
}

/**
 * Lembrete para quem VAI ATENDER.
 *
 * Omite a linha "Monitor(a)" — e ele — e acrescenta o numero de inscritos, que
 * e o dado que muda o que ele faz: decidir se prepara material para um ou para
 * oito, ou se vale cancelar quando ninguem se inscreveu.
 */
function lembreteDoMonitor({ nome, dados, fuso, link, inscritos }: ContextoDaMensagem): Mensagem {
  const quantos = inscritos ?? 0;

  return {
    assunto: `Lembrete: você conduz um atendimento hoje (${dados.disciplina})`,
    corpo: [
      `Olá, ${nome}.`,
      '',
      'Você conduz um atendimento de monitoria HOJE:',
      '',
      ...blocoDoAtendimento(dados, fuso, false),
      `Inscritos: ${quantos === 0 ? 'nenhum até agora' : quantos}`,
      '',
      quantos === 0
        ? 'Ninguém se inscreveu até o momento. Se preferir cancelar, faça pela plataforma.'
        : 'Se precisar cancelar ou mudar o horário, faça pela plataforma: os inscritos',
      ...(quantos === 0 ? [] : ['são avisados automaticamente.']),
      ...acesse('Ver atendimento', link),
    ].join('\n'),
  };
}

/** Chamada para acao, sempre no fim e sempre em linha propria. */
function acesse(rotulo: string, link: string): string[] {
  return ['', `${rotulo}: ${link}`];
}

/**
 * Uma funcao por tipo, reunidas em um mapa.
 *
 * Preferido a um `switch` dentro do service para que acrescentar um tipo seja
 * acrescentar uma entrada aqui — e para que o compilador cobre a entrada quando
 * o enum crescer, em vez de deixar passar um `default` silencioso.
 */
export const MENSAGENS: Record<TipoNotificacao, (contexto: ContextoDaMensagem) => Mensagem> = {
  /**
   * Dois textos para o mesmo fato, conforme quem le.
   *
   * O monitorado precisa saber onde comparecer e como desistir; o monitor
   * precisa saber quantas pessoas esperar e que mexer no horario avisa todo
   * mundo. Dizer "cancele sua inscricao" a quem conduz o atendimento seria
   * instrucao impossivel — ele nao tem inscricao para cancelar.
   */
  [TipoNotificacao.LEMBRETE_DIA]: (contexto) =>
    contexto.papel === PapelMonitoria.MONITOR
      ? lembreteDoMonitor(contexto)
      : lembreteDoMonitorado(contexto),

  [TipoNotificacao.ATENDIMENTO_CANCELADO]: ({ nome, dados, fuso, link, motivo }) => ({
    assunto: `Atendimento CANCELADO: ${dados.disciplina}`,
    corpo: [
      `Olá, ${nome}.`,
      '',
      'O atendimento abaixo foi CANCELADO e não vai acontecer:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      '',
      `Motivo: ${motivo ?? 'não informado'}`,
      '',
      'Não é necessário comparecer. Novos horários aparecem na plataforma.',
      ...acesse('Ver detalhes', link),
    ].join('\n'),
  }),

  [TipoNotificacao.ATENDIMENTO_REAGENDADO]: ({ nome, dados, fuso, link }) => ({
    assunto: `Novo horário: ${dados.disciplina}`,
    corpo: [
      `Olá, ${nome}.`,
      '',
      'Um atendimento em que você está inscrito(a) MUDOU DE HORÁRIO.',
      'Sua inscrição foi mantida — atenção ao novo horário:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      '',
      'Se o novo horário não servir, cancele sua inscrição.',
      ...acesse('Ver atendimento', link),
    ].join('\n'),
  }),

  [TipoNotificacao.ATENDIMENTO_SOLICITADO]: ({ nome, dados, fuso, link }) => ({
    assunto: `Novo atendimento solicitado: ${dados.disciplina}`,
    corpo: [
      `Olá, ${nome}.`,
      '',
      'Um aluno solicitou um atendimento com você:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      '',
      'O horário já está reservado na sua agenda.',
      ...acesse('Ver atendimento', link),
    ].join('\n'),
  }),

  /**
   * Um aviso serve tanto para a sessao avulsa quanto para a serie inteira.
   *
   * Quando o lote (A2) cria varias, o monitorado recebe UM e-mail: o detalhe da
   * primeira sessao e uma linha dizendo quantas outras vieram junto. Um e-mail
   * por ocorrencia encheria a caixa e faria quem marcasse spam derrubar a
   * entrega do lembrete do dia, que e o aviso que de fato importa.
   */
  [TipoNotificacao.ATENDIMENTO_OFERTADO]: ({ nome, dados, fuso, link, demaisSessoes }) => ({
    assunto: `Novo horário de monitoria disponível: ${dados.disciplina}`,
    corpo: [
      `Olá, ${nome}.`,
      '',
      demaisSessoes
        ? 'Foi aberta uma série de horários de monitoria na sua disciplina. O primeiro:'
        : 'Foi aberto um novo horário de monitoria na sua disciplina:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      ...(demaisSessoes
        ? [
            '',
            demaisSessoes === 1
              ? 'E mais 1 sessão na mesma faixa de horário.'
              : `E mais ${demaisSessoes} sessões na mesma faixa de horário.`,
          ]
        : []),
      '',
      'As vagas são limitadas.',
      ...acesse(demaisSessoes ? 'Ver a agenda da monitoria' : 'Inscrever-se', link),
    ].join('\n'),
  }),

  [TipoNotificacao.AVALIACAO_PENDENTE]: ({ nome, dados, fuso, link }) => ({
    assunto: `Como foi o atendimento de ${dados.disciplina}?`,
    corpo: [
      `Olá, ${nome}.`,
      '',
      'Seu atendimento foi concluído:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      '',
      'A avaliação leva menos de um minuto e é o que permite acompanhar a',
      'qualidade da monitoria.',
      ...acesse('Avaliar atendimento', link),
    ].join('\n'),
  }),

  /** Nao fala de atendimento: o unico tipo cujo bloco nao se aplica. */
  [TipoNotificacao.MONITOR_HABILITADO]: ({ nome, dados, link, inscricoesCanceladas }) => ({
    assunto: `Você agora é monitor(a) de ${dados.disciplina}`,
    corpo: [
      `Olá, ${nome}.`,
      '',
      `Você foi habilitado(a) como MONITOR(A) na monitoria de ${dados.disciplina}.`,
      ...(inscricoesCanceladas
        ? [
            '',
            /**
             * Singular e plural em DUAS linhas cada, e nao um sufixo comum.
             *
             * O texto anterior fechava sempre com "foi cancelada", inclusive na
             * ramificacao plural ("suas inscricoes em 3 atendimentos ... foi
             * cancelada") — erro de concordancia que so aparece quando a
             * promocao atinge mais de um atendimento.
             */
            inscricoesCanceladas === 1
              ? 'Como você passou de monitorado(a) a monitor(a), sua inscrição em 1 atendimento'
              : `Como você passou de monitorado(a) a monitor(a), suas inscrições em ${inscricoesCanceladas} atendimentos`,
            inscricoesCanceladas === 1
              ? 'desta monitoria foi cancelada — agora você conduz as sessões, em vez de assistir.'
              : 'desta monitoria foram canceladas — agora você conduz as sessões, em vez de assistir.',
          ]
        : []),
      '',
      'Próximos passos na plataforma:',
      '  1. declare sua disponibilidade semanal;',
      '  2. abra horários de atendimento ou aguarde solicitações;',
      '  3. publique materiais de apoio, se quiser.',
      '',
      'Sem disponibilidade declarada, ninguém consegue agendar com você.',
      ...acesse('Acessar a monitoria', link),
    ].join('\n'),
  }),
};
