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

/** Bloco comum a todo aviso sobre um atendimento. */
function blocoDoAtendimento(dados: DadosDoAtendimento, fuso: string): string[] {
  const linhas = [
    `Disciplina: ${dados.disciplina}`,
    `Quando: ${formatarDataHora(dados.inicio, fuso)} as ${formatarHora(dados.fim, fuso)}`,
    `Monitor(a): ${dados.monitor}`,
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
  [TipoNotificacao.LEMBRETE_DIA]: ({ nome, dados, fuso, link }) => ({
    assunto: `Lembrete: voce tem atendimento hoje (${dados.disciplina})`,
    corpo: [
      `Ola, ${nome}.`,
      '',
      'Voce tem um atendimento de monitoria HOJE:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      '',
      'Se nao puder comparecer, cancele sua inscricao para liberar a vaga.',
      ...acesse('Ver atendimento', link),
    ].join('\n'),
  }),

  [TipoNotificacao.ATENDIMENTO_CANCELADO]: ({ nome, dados, fuso, link, motivo }) => ({
    assunto: `Atendimento CANCELADO: ${dados.disciplina}`,
    corpo: [
      `Ola, ${nome}.`,
      '',
      'O atendimento abaixo foi CANCELADO e nao vai acontecer:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      '',
      `Motivo: ${motivo ?? 'nao informado'}`,
      '',
      'Nao e necessario comparecer. Novos horarios aparecem na plataforma.',
      ...acesse('Ver detalhes', link),
    ].join('\n'),
  }),

  [TipoNotificacao.ATENDIMENTO_REAGENDADO]: ({ nome, dados, fuso, link }) => ({
    assunto: `Novo horario: ${dados.disciplina}`,
    corpo: [
      `Ola, ${nome}.`,
      '',
      'Um atendimento em que voce esta inscrito(a) MUDOU DE HORARIO.',
      'Sua inscricao foi mantida — atencao ao novo horario:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      '',
      'Se o novo horario nao servir, cancele sua inscricao.',
      ...acesse('Ver atendimento', link),
    ].join('\n'),
  }),

  [TipoNotificacao.ATENDIMENTO_SOLICITADO]: ({ nome, dados, fuso, link }) => ({
    assunto: `Novo atendimento solicitado: ${dados.disciplina}`,
    corpo: [
      `Ola, ${nome}.`,
      '',
      'Um aluno solicitou um atendimento com voce:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      '',
      'O horario ja esta reservado na sua agenda.',
      ...acesse('Ver atendimento', link),
    ].join('\n'),
  }),

  [TipoNotificacao.ATENDIMENTO_OFERTADO]: ({ nome, dados, fuso, link }) => ({
    assunto: `Novo horario de monitoria disponivel: ${dados.disciplina}`,
    corpo: [
      `Ola, ${nome}.`,
      '',
      'Foi aberto um novo horario de monitoria na sua disciplina:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      '',
      'As vagas sao limitadas.',
      ...acesse('Inscrever-se', link),
    ].join('\n'),
  }),

  [TipoNotificacao.AVALIACAO_PENDENTE]: ({ nome, dados, fuso, link }) => ({
    assunto: `Como foi o atendimento de ${dados.disciplina}?`,
    corpo: [
      `Ola, ${nome}.`,
      '',
      'Seu atendimento foi concluido:',
      '',
      ...blocoDoAtendimento(dados, fuso),
      '',
      'A avaliacao leva menos de um minuto e e o que permite acompanhar a',
      'qualidade da monitoria.',
      ...acesse('Avaliar atendimento', link),
    ].join('\n'),
  }),

  /** Nao fala de atendimento: o unico tipo cujo bloco nao se aplica. */
  [TipoNotificacao.MONITOR_HABILITADO]: ({ nome, dados, link }) => ({
    assunto: `Voce agora e monitor(a) de ${dados.disciplina}`,
    corpo: [
      `Ola, ${nome}.`,
      '',
      `Voce foi habilitado(a) como MONITOR(A) na monitoria de ${dados.disciplina}.`,
      '',
      'Proximos passos na plataforma:',
      '  1. declare sua disponibilidade semanal;',
      '  2. abra horarios de atendimento ou aguarde solicitacoes;',
      '  3. publique materiais de apoio, se quiser.',
      '',
      'Sem disponibilidade declarada, ninguem consegue agendar com voce.',
      ...acesse('Acessar a monitoria', link),
    ].join('\n'),
  }),
};
