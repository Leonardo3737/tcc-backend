import { MensagemEmail } from '../email/mensagem-email';

/**
 * Texto do e-mail de confirmacao de inscricao. Funcao PURA.
 *
 * Separada do service pelo mesmo motivo de `notificacoes/mensagens.ts`: o corpo
 * da mensagem e a parte que precisa ser conferida palavra por palavra, e e a
 * unica que se pode testar sem banco, sem rede e sem provedor.
 *
 * O QUE NAO ENTRA, por decisao:
 *
 *  - o PDF do boletim, nem como anexo nem como link. Reenviar ao candidato um
 *    arquivo que ele acabou de mandar nao informa nada, engorda a mensagem e
 *    coloca documento academico em transito por um canal que nao controlamos;
 *  - as notas e a media. O e-mail confirma um ATO ("sua inscricao foi
 *    registrada"), nao e um comprovante de desempenho. E-mail trafega e fica
 *    arquivado em servidor de terceiro; nota nao precisa ir junto;
 *  - qualquer dado de outro candidato.
 *
 * O que entra e o que o escopo pede e o candidato usa: o nome dele, de que
 * edital se trata, o identificador da inscricao e o link do edital oficial.
 */
export interface DadosDaConfirmacao {
  nomeCompleto: string;
  email: string;
  inscricaoId: string;
  ano: number;
  semestre: number;
  fimInscricoes: string;
  linkDoEdital: string;
  /** Raiz do sistema (`app.urlFront`). Ver a nota em `montarConfirmacao`. */
  urlDoSistema: string;
}

export function montarConfirmacao(dados: DadosDaConfirmacao): MensagemEmail {
  const periodo = `${dados.ano}/${dados.semestre}`;

  return {
    para: [{ email: dados.email, nome: dados.nomeCompleto }],
    assunto: `Inscrição confirmada — edital de monitoria ${periodo}`,
    texto: [
      `Olá, ${dados.nomeCompleto}.`,
      '',
      `Sua inscrição no edital de seleção de monitores ${periodo} foi registrada.`,
      '',
      `Identificador da inscrição: ${dados.inscricaoId}`,
      'Guarde este número: é por ele que a coordenação localiza sua candidatura.',
      '',
      `Prazo de inscrições: até ${dados.fimInscricoes}.`,
      `Edital oficial: ${dados.linkDoEdital}`,
      '',
      /**
       * Aponta para a RAIZ do sistema, pela mesma razao registrada em
       * `UsuariosService.entregarSenhaGerada`: uma rota especifica seria palpite
       * sobre o frontend, e link quebrado em e-mail nao tem conserto depois de
       * enviado. O candidato tipico ainda nao tem conta — a conta e criada pelo
       * professor se ele for aprovado —, entao o link e informativo.
       */
      `Plataforma de monitoria: ${dados.urlDoSistema}`,
      '',
      'Esta mensagem é automática; não é necessário responder.',
    ].join('\n'),
  };
}
