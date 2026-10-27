import { PedidoDeAutorizacao } from './oauth.service';

/** Escapa texto para HTML. Tudo que vem da requisicao passa por aqui. */
function esc(valor: string | undefined | null): string {
  return (valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ESTILO = `
  :root { color-scheme: light dark; --fundo:#f4f5f7; --cartao:#fff; --texto:#1c1f24; --suave:#5d6470; --borda:#d6d9de; --primaria:#1f5fbf; --erro:#b42318; }
  @media (prefers-color-scheme: dark) { :root { --fundo:#121417; --cartao:#1c1f24; --texto:#eceef1; --suave:#a4abb6; --borda:#353a42; --primaria:#5b9bf0; --erro:#f97066; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px; background:var(--fundo); color:var(--texto); font:16px/1.5 system-ui, sans-serif; }
  main { width:100%; max-width:400px; background:var(--cartao); border:1px solid var(--borda); border-radius:12px; padding:28px; }
  h1 { font-size:1.25rem; margin:0 0 8px; }
  p { margin:0 0 16px; color:var(--suave); }
  .destino { font-size:.875rem; padding:10px 12px; border:1px solid var(--borda); border-radius:8px; margin-bottom:20px; overflow-wrap:anywhere; }
  .destino strong { color:var(--texto); }
  label { display:block; font-size:.875rem; font-weight:600; margin:12px 0 4px; }
  input[type=email], input[type=password] { width:100%; padding:10px 12px; font:inherit; color:inherit; background:transparent; border:1px solid var(--borda); border-radius:8px; }
  .acoes { display:flex; gap:8px; margin-top:24px; }
  button { flex:1; padding:10px; font:inherit; font-weight:600; border-radius:8px; cursor:pointer; border:1px solid var(--borda); background:transparent; color:var(--texto); }
  button[value=autorizar] { background:var(--primaria); border-color:var(--primaria); color:#fff; }
  .erro { color:var(--erro); font-weight:600; }
`;

function pagina(titulo: string, corpo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title><style>${ESTILO}</style></head>
<body><main>${corpo}</main></body></html>`;
}

/**
 * Tela de login e consentimento.
 *
 * Mostra o HOST de retorno com destaque, como a especificacao do MCP exige:
 * e o que permite ao usuario perceber um aplicativo se passando por outro.
 */
export function paginaDeLogin(
  pedido: PedidoDeAutorizacao,
  nomeCliente: string | null,
  mensagemErro?: string,
  emailDigitado?: string,
): string {
  const host = (() => {
    try {
      return new URL(pedido.redirect_uri ?? '').host;
    } catch {
      return '';
    }
  })();

  const campos: (keyof PedidoDeAutorizacao)[] = [
    'response_type',
    'client_id',
    'redirect_uri',
    'state',
    'scope',
    'code_challenge',
    'code_challenge_method',
    'resource',
  ];
  const ocultos = campos
    .filter((campo) => pedido[campo] !== undefined)
    .map((campo) => `<input type="hidden" name="${campo}" value="${esc(pedido[campo])}">`)
    .join('');

  return pagina(
    'Entrar - Plataforma de Monitoria',
    `<h1>Conectar à Plataforma de Monitoria</h1>
     <p><strong>${esc(nomeCliente ?? 'Um aplicativo')}</strong> quer acessar a plataforma em seu nome, com as mesmas permissões da sua conta.</p>
     <div class="destino">Após entrar, você volta para: <strong>${esc(host)}</strong></div>
     ${mensagemErro ? `<p class="erro" role="alert">${esc(mensagemErro)}</p>` : ''}
     <form method="post" autocomplete="on">
       ${ocultos}
       <label for="email">E-mail</label>
       <input id="email" name="email" type="email" required autocomplete="username" value="${esc(emailDigitado)}">
       <label for="senha">Senha</label>
       <input id="senha" name="senha" type="password" required autocomplete="current-password">
       <div class="acoes">
         <button type="submit" name="acao" value="negar" formnovalidate>Cancelar</button>
         <button type="submit" name="acao" value="autorizar">Entrar e autorizar</button>
       </div>
     </form>`,
  );
}

export function paginaDeErro(mensagem: string): string {
  return pagina(
    'Erro - Plataforma de Monitoria',
    `<h1>Não foi possível continuar</h1><p class="erro">${esc(mensagem)}</p>
     <p>Feche esta janela e tente conectar de novo pelo aplicativo.</p>`,
  );
}
