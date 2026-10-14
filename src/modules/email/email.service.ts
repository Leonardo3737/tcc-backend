import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CorpoBrevo, MensagemEmail, RemetenteEmail, montarCorpoBrevo } from './mensagem-email';

const URL_BREVO = 'https://api.brevo.com/v3/smtp/email';

/** Teto de espera pelo provedor. Ver `despachar`. */
const TIMEOUT_MS = 10_000;

/**
 * Envio de e-mail transacional pelo Brevo.
 *
 * Ponto unico de saida de e-mail da aplicacao. Sem BREVO_API_KEY ou
 * EMAIL_REMETENTE_EMAIL o servico opera em MODO LOG: registra o que teria
 * enviado e devolve `false`, sem tocar na rede. E o comportamento padrao em
 * desenvolvimento.
 *
 * O acoplamento com o provedor esta inteiro em mensagem-email.ts (formato) e em
 * `despachar` (protocolo). Trocar de provedor nao alcanca quem chama.
 *
 * POLITICA DE FALHA: `enviar` nunca lanca.
 *
 * E a mesma escolha ja feita na gamificacao, pelo mesmo motivo. E-mail e canal
 * lateral: se a notificacao de um atendimento agendado falhar, o atendimento
 * continua agendado. Deixar a excecao subir faria o provedor de e-mail ter
 * poder de veto sobre regra de negocio — e um servico externo, fora do nosso
 * controle, derrubaria operacoes academicas. Quem precisar saber do resultado
 * le o retorno; quem nao precisar pode ignorar com seguranca.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Anuncia o estado no boot — e, em producao, impede subir sem e-mail.
   *
   * O e-mail deixou de ser canal lateral quando passou a ENTREGAR credenciais:
   * a senha de um usuario novo e o codigo de recuperacao so chegam por ele.
   * Sem configuracao, uma instalacao de producao criaria contas que ninguem
   * consegue acessar e nao teria como recuperar nenhuma senha — falha silenciosa,
   * descoberta pelo usuario final.
   *
   * Por isso a recusa e no boot, nao um aviso. Um `logger.warn` em producao rola
   * para fora da tela e ninguem ve; e o mesmo raciocinio que o projeto ja aplicou
   * a outras configuracoes criticas. Em desenvolvimento o modo log continua
   * valendo, porque ali a conveniencia vale mais e o risco nao existe.
   */
  onModuleInit(): void {
    const { nome, email } = this.remetente();
    const ambiente = this.config.get<string>('app.ambiente');

    if (!this.estaConfigurado()) {
      if (ambiente === 'production') {
        throw new Error(
          'BREVO_API_KEY e EMAIL_REMETENTE_EMAIL sao obrigatorios em producao: sem eles ' +
            'a senha de usuarios novos e o codigo de recuperacao nao tem como chegar a ' +
            'ninguem, e as contas nascem inacessiveis.',
        );
      }

      this.logger.warn(
        'E-mail NAO configurado (BREVO_API_KEY e/ou EMAIL_REMETENTE_EMAIL vazios). ' +
          'Mensagens serao apenas registradas no log. Em producao a aplicacao se ' +
          'recusa a subir assim.',
      );
      return;
    }

    this.logger.log(`E-mail habilitado via Brevo, remetente ${nome} <${email}>.`);
  }

  /**
   * Ponto unico de envio da aplicacao.
   *
   * @returns `true` quando o Brevo aceitou a mensagem. `false` em qualquer outro
   *   caso — modo log, mensagem invalida, erro do provedor ou falha de rede.
   *   Nunca lanca (ver a politica na documentacao da classe).
   */
  async enviar(mensagem: MensagemEmail): Promise<boolean> {
    if (!this.validar(mensagem)) {
      return false;
    }

    const corpo = montarCorpoBrevo(mensagem, this.remetente());

    if (!this.estaConfigurado()) {
      this.registrarModoLog(corpo);
      return false;
    }

    return this.despachar(corpo);
  }

  /**
   * A unica parte que fala HTTP com o provedor.
   *
   * O timeout nao e opcional: sem ele, uma indisponibilidade do Brevo prenderia
   * a requisicao do usuario pelo tempo que o sistema operacional levar para
   * desistir da conexao — minutos, potencialmente. Com 10s, o pior caso e uma
   * mensagem nao entregue, que e exatamente o que a politica de falha permite.
   */
  private async despachar(corpo: CorpoBrevo): Promise<boolean> {
    const destinatarios = corpo.to.map((d) => d.email).join(', ');

    try {
      const resposta = await fetch(URL_BREVO, {
        method: 'POST',
        headers: {
          'api-key': this.config.get<string>('email.brevoApiKey') ?? '',
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!resposta.ok) {
        /**
         * O corpo do erro vem do Brevo e descreve o que ELE recusou (remetente
         * nao verificado, cota estourada, chave invalida) — nao contem a nossa
         * mensagem. Registra-lo e seguro e evita que "o e-mail nao chegou" vire
         * investigacao as cegas. O corte existe porque um proxy no caminho pode
         * devolver uma pagina HTML inteira no lugar do JSON.
         */
        const detalhe = (await resposta.text().catch(() => '')).slice(0, 300);

        this.logger.error(
          `Brevo recusou a mensagem para ${destinatarios}: HTTP ${resposta.status} ${detalhe}`,
        );
        return false;
      }

      this.logger.log(`E-mail enviado para ${destinatarios} | assunto: "${corpo.subject}"`);
      return true;
    } catch (erro) {
      // Timeout e queda de rede caem aqui. Nao sobem: e-mail nao derruba
      // operacao de dominio.
      const motivo = erro instanceof Error ? erro.message : String(erro);

      this.logger.error(`Falha ao enviar e-mail para ${destinatarios}: ${motivo}`);
      return false;
    }
  }

  /** Ha chave e remetente para falar com o Brevo. Falso = modo log. */
  estaConfigurado(): boolean {
    const { email } = this.remetente();
    return Boolean(this.config.get<string>('email.brevoApiKey')) && Boolean(email);
  }

  private remetente(): RemetenteEmail {
    return {
      nome: this.config.get<string>('email.remetenteNome') ?? '',
      email: this.config.get<string>('email.remetenteEmail') ?? '',
    };
  }

  /**
   * Erro de quem chamou vira log, nao excecao (politica de falha).
   *
   * Mensagem sem destinatario ou sem assunto e defeito de programacao, e
   * aparece no log como aviso explicito em vez de passar despercebida.
   */
  private validar(mensagem: MensagemEmail): boolean {
    if (!mensagem.para?.length) {
      this.logger.warn('Mensagem descartada: nenhum destinatario informado.');
      return false;
    }

    if (!mensagem.assunto?.trim()) {
      this.logger.warn('Mensagem descartada: assunto vazio.');
      return false;
    }

    if (!mensagem.texto?.trim()) {
      this.logger.warn('Mensagem descartada: corpo em texto vazio.');
      return false;
    }

    return true;
  }

  /**
   * Modo log: registra o que SERIA enviado — sem o corpo.
   *
   * Destinatario e assunto bastam para acompanhar o fluxo em desenvolvimento. O
   * corpo fica de fora por decisao de seguranca: a recuperacao de senha carrega
   * um codigo de troca de senha, e log costuma ser o lugar menos protegido da
   * operacao. Vale tambem para o caminho de sucesso em `despachar`.
   */
  private registrarModoLog(corpo: CorpoBrevo): void {
    const destinatarios = corpo.to.map((d) => d.email).join(', ');

    this.logger.log(
      `[NAO ENVIADO] para: ${destinatarios} | assunto: "${corpo.subject}" ` +
        '(e-mail nao configurado — modo log)',
    );
  }
}
