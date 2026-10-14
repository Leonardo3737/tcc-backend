/**
 * Contrato de mensagem de e-mail e traducao para o formato do Brevo.
 *
 * Este arquivo e a UNICA superficie que conhece o provedor. O resto da
 * aplicacao fala em `MensagemEmail` — destinatario, assunto, corpo — e nao sabe
 * que existe Brevo. Trocar de provedor (ver alternativas no README) significa
 * reescrever `montarCorpoBrevo` e nada alem disso.
 *
 * `montarCorpoBrevo` e funcao pura e exportada de proposito: e a parte
 * testavel do envio, e deixa-la privada dentro do service obrigaria a testar
 * o formato por vias indiretas.
 */

export interface DestinatarioEmail {
  email: string;
  nome?: string;
}

export interface MensagemEmail {
  /** Um ou mais destinatarios. Lista vazia e erro de quem chamou. */
  para: DestinatarioEmail[];
  assunto: string;
  /**
   * Corpo em texto puro. Obrigatorio mesmo quando ha HTML: cliente que nao
   * renderiza HTML recebe algo legivel, e filtros antispam penalizam mensagens
   * so-HTML.
   */
  texto: string;
  html?: string;
}

export interface RemetenteEmail {
  nome: string;
  email: string;
}

/**
 * Formato aceito por POST https://api.brevo.com/v3/smtp/email.
 *
 * Os nomes dos campos sao do provedor, por isso estao em ingles — renomea-los
 * para portugues exigiria um mapeamento a mais sem nenhum ganho.
 */
export interface CorpoBrevo {
  sender: { name: string; email: string };
  to: { email: string; name?: string }[];
  subject: string;
  textContent: string;
  htmlContent?: string;
}

export function montarCorpoBrevo(mensagem: MensagemEmail, remetente: RemetenteEmail): CorpoBrevo {
  return {
    sender: { name: remetente.nome, email: remetente.email },
    to: mensagem.para.map((destinatario) => ({
      email: destinatario.email,
      // Brevo rejeita `name: null`; omitir a chave e o caminho aceito.
      ...(destinatario.nome ? { name: destinatario.nome } : {}),
    })),
    subject: mensagem.assunto,
    textContent: mensagem.texto,
    ...(mensagem.html ? { htmlContent: mensagem.html } : {}),
  };
}
