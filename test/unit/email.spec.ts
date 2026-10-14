import { EmailService } from '../../src/modules/email/email.service';
import { MensagemEmail, montarCorpoBrevo } from '../../src/modules/email/mensagem-email';

/**
 * O envio real so pode ser verificado contra o Brevo. O que da para travar aqui
 * e tudo o que vem ANTES e DEPOIS da rede: quando o servico decide nao enviar,
 * o que ele manda no corpo da requisicao, e o que acontece quando o provedor
 * recusa ou some. Sao justamente os pontos em que um erro passaria calado.
 */

const CONFIG_COMPLETA: Record<string, string> = {
  'email.brevoApiKey': 'xkeysib-chave-de-teste',
  'email.remetenteNome': 'Monitoria UFX',
  'email.remetenteEmail': 'nao-responda@ufx.edu.br',
};

function montar(valores: Record<string, string> = CONFIG_COMPLETA) {
  const config = { get: jest.fn((chave: string) => valores[chave] ?? '') };

  return { service: new EmailService(config as never), config };
}

/** Substitui `fetch` e devolve o espiao, restaurando o original no fim. */
function comFetch(implementacao: jest.Mock) {
  const original = global.fetch;
  global.fetch = implementacao as never;

  return () => {
    global.fetch = original;
  };
}

function resposta(status: number, corpo = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(corpo),
  };
}

const mensagem: MensagemEmail = {
  para: [{ email: 'ana@ufx.edu.br', nome: 'Ana Martins' }],
  assunto: 'Atendimento confirmado',
  texto: 'Seu atendimento foi confirmado para quinta, 14h.',
};

describe('EmailService — modo log (sem credencial)', () => {
  /**
   * Em desenvolvimento o padrao e nao ter chave. O servico precisa degradar
   * para log em vez de tentar a rede: um `fetch` com api-key vazia renderia
   * 401 do Brevo a cada operacao, poluindo o log com erro que nao e erro.
   */
  it('nao toca a rede quando falta configuracao', async () => {
    const espiao = jest.fn();
    const restaurar = comFetch(espiao);

    try {
      const { service } = montar({});

      await expect(service.enviar(mensagem)).resolves.toBe(false);
      expect(espiao).not.toHaveBeenCalled();
    } finally {
      restaurar();
    }
  });

  it('nao toca a rede quando ha chave mas falta remetente', async () => {
    const espiao = jest.fn();
    const restaurar = comFetch(espiao);

    try {
      const { service } = montar({ ...CONFIG_COMPLETA, 'email.remetenteEmail': '' });

      await service.enviar(mensagem);
      expect(espiao).not.toHaveBeenCalled();
    } finally {
      restaurar();
    }
  });
});

describe('EmailService — despacho para o Brevo', () => {
  it('chama a API do provedor com chave, formato e timeout', async () => {
    const espiao = jest.fn().mockResolvedValue(resposta(201, '{"messageId":"abc"}'));
    const restaurar = comFetch(espiao);

    try {
      const { service } = montar();

      await expect(service.enviar(mensagem)).resolves.toBe(true);

      const [url, opcoes] = espiao.mock.calls[0];

      expect(url).toBe('https://api.brevo.com/v3/smtp/email');
      expect(opcoes.method).toBe('POST');
      expect(opcoes.headers['api-key']).toBe('xkeysib-chave-de-teste');
      expect(opcoes.headers['content-type']).toBe('application/json');

      // Sem timeout, indisponibilidade do provedor vira requisicao pendurada.
      expect(opcoes.signal).toBeInstanceOf(AbortSignal);

      expect(JSON.parse(opcoes.body)).toEqual({
        sender: { name: 'Monitoria UFX', email: 'nao-responda@ufx.edu.br' },
        to: [{ email: 'ana@ufx.edu.br', name: 'Ana Martins' }],
        subject: 'Atendimento confirmado',
        textContent: 'Seu atendimento foi confirmado para quinta, 14h.',
      });
    } finally {
      restaurar();
    }
  });

  /**
   * Os dois casos que a politica de falha existe para cobrir. Se um deles
   * lancar, uma recuperacao de senha ou um agendamento passa a falhar porque o
   * provedor de e-mail esta fora do ar.
   */
  it('devolve false, sem lancar, quando o Brevo recusa', async () => {
    const espiao = jest.fn().mockResolvedValue(resposta(400, '{"message":"sender not valid"}'));
    const restaurar = comFetch(espiao);

    try {
      const { service } = montar();
      jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

      await expect(service.enviar(mensagem)).resolves.toBe(false);
    } finally {
      restaurar();
    }
  });

  it('devolve false, sem lancar, quando a rede falha ou estoura o timeout', async () => {
    const espiao = jest.fn().mockRejectedValue(new Error('The operation was aborted'));
    const restaurar = comFetch(espiao);

    try {
      const { service } = montar();
      jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

      await expect(service.enviar(mensagem)).resolves.toBe(false);
    } finally {
      restaurar();
    }
  });
});

describe('EmailService — politica de falha na entrada', () => {
  it.each([
    ['sem destinatario', { ...mensagem, para: [] }],
    ['sem assunto', { ...mensagem, assunto: '   ' }],
    ['sem corpo em texto', { ...mensagem, texto: '' }],
  ])('%s: devolve false em vez de lancar, e nem chega a rede', async (_caso, invalida) => {
    const espiao = jest.fn();
    const restaurar = comFetch(espiao);

    try {
      const { service } = montar();

      await expect(service.enviar(invalida as MensagemEmail)).resolves.toBe(false);
      expect(espiao).not.toHaveBeenCalled();
    } finally {
      restaurar();
    }
  });
});

describe('EmailService — o corpo da mensagem nunca vai para o log', () => {
  /**
   * A recuperacao de senha manda um codigo de troca de senha dentro do corpo.
   * Log costuma ser o lugar menos protegido da operacao — e, em producao, vai
   * para agregadores que muita gente le.
   */
  it.each([
    ['modo log', {}, undefined],
    ['envio bem-sucedido', CONFIG_COMPLETA, jest.fn().mockResolvedValue(resposta(201))],
  ])('%s: registra destinatario e assunto, nunca o conteudo', async (_caso, cfg, fetchMock) => {
    const restaurar = comFetch((fetchMock ?? jest.fn()) as jest.Mock);

    try {
      const { service } = montar(cfg as Record<string, string>);
      const registrado: string[] = [];

      jest
        .spyOn(service['logger'], 'log')
        .mockImplementation((texto: unknown) => registrado.push(String(texto)));

      await service.enviar({
        ...mensagem,
        texto: 'SEGREDO-NAO-PODE-APARECER',
        html: '<p>SEGREDO-NAO-PODE-APARECER</p>',
      });

      const tudo = registrado.join('\n');

      expect(tudo).toContain('ana@ufx.edu.br');
      expect(tudo).toContain('Atendimento confirmado');
      expect(tudo).not.toContain('SEGREDO-NAO-PODE-APARECER');
    } finally {
      restaurar();
    }
  });
});

describe('estaConfigurado', () => {
  it('exige chave E remetente', () => {
    expect(montar().service.estaConfigurado()).toBe(true);
    expect(montar({}).service.estaConfigurado()).toBe(false);

    const semRemetente = { ...CONFIG_COMPLETA, 'email.remetenteEmail': '' };
    expect(montar(semRemetente).service.estaConfigurado()).toBe(false);

    const semChave = { ...CONFIG_COMPLETA, 'email.brevoApiKey': '' };
    expect(montar(semChave).service.estaConfigurado()).toBe(false);
  });
});

/**
 * O formato do provedor e a unica parte do envio verificavel sem rede. Vale a
 * pena: um campo errado aqui so apareceria como 400 do Brevo em producao.
 */
describe('montarCorpoBrevo', () => {
  const remetente = { nome: 'Monitoria UFX', email: 'nao-responda@ufx.edu.br' };

  it('traduz MensagemEmail para o formato de POST /v3/smtp/email', () => {
    expect(montarCorpoBrevo(mensagem, remetente)).toEqual({
      sender: { name: 'Monitoria UFX', email: 'nao-responda@ufx.edu.br' },
      to: [{ email: 'ana@ufx.edu.br', name: 'Ana Martins' }],
      subject: 'Atendimento confirmado',
      textContent: 'Seu atendimento foi confirmado para quinta, 14h.',
    });
  });

  it('omite a chave name quando o destinatario nao tem nome', () => {
    const corpo = montarCorpoBrevo(
      { ...mensagem, para: [{ email: 'bruno@ufx.edu.br' }] },
      remetente,
    );

    // Brevo rejeita `name: null`; a chave precisa estar AUSENTE, nao vazia.
    expect(corpo.to[0]).toEqual({ email: 'bruno@ufx.edu.br' });
    expect('name' in corpo.to[0]).toBe(false);
  });

  it('inclui htmlContent apenas quando ha html', () => {
    expect(montarCorpoBrevo(mensagem, remetente).htmlContent).toBeUndefined();

    const comHtml = montarCorpoBrevo({ ...mensagem, html: '<p>Oi</p>' }, remetente);
    expect(comHtml.htmlContent).toBe('<p>Oi</p>');
    // textContent continua presente: cliente sem HTML e filtro antispam.
    expect(comHtml.textContent).toBe(mensagem.texto);
  });

  it('preserva varios destinatarios na ordem recebida', () => {
    const corpo = montarCorpoBrevo(
      {
        ...mensagem,
        para: [{ email: 'a@ufx.edu.br' }, { email: 'b@ufx.edu.br', nome: 'Bruno' }],
      },
      remetente,
    );

    expect(corpo.to).toEqual([{ email: 'a@ufx.edu.br' }, { email: 'b@ufx.edu.br', name: 'Bruno' }]);
  });
});
