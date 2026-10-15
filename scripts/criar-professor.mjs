/**
 * Cria um professor direto no banco, FORA da API.
 *
 * Existe por uma consequencia inevitavel de fechar o auto-cadastro: criar conta
 * passou a exigir um professor autenticado, e uma base nova nao tem nenhum. Sem
 * este script a plataforma nao teria como ser inicializada — nem com um ADMIN
 * embutido, que seria um usuario privilegiado a mais para proteger.
 *
 * A barreira aqui nao e um segredo compartilhado (o antigo
 * CODIGO_CADASTRO_PROFESSOR, que podia circular por e-mail): e possuir as
 * credenciais do PostgreSQL. Quem as tem ja podia inserir a linha na mao; o
 * script apenas evita que o hash argon2 seja gerado por fora e colado errado.
 *
 * Uso (o banco precisa estar migrado):
 *
 *   npm run criar-professor -- --nome "Joao Ribeiro" --email joao@ufx.edu.br
 *
 * A senha pode vir em --senha ou em PROFESSOR_SENHA. Omitindo as duas, o script
 * gera uma aleatoria e a imprime UMA vez — preferivel, porque a senha nao fica
 * no historico do shell.
 *
 * Opcionais: --identificacao (SIAPE) e --departamento.
 */
import { randomBytes, randomUUID } from 'node:crypto';

/**
 * dotenv e devDependency: em producao (`npm ci --omit=dev`) ele nao existe, e as
 * variaveis ja vem do ambiente. Importar sem o try quebraria o script justamente
 * no cenario em que ele e mais necessario — a primeira subida.
 */
try {
  await import('dotenv/config');
} catch {
  // Sem .env: segue com process.env como esta.
}

import argon2 from 'argon2';
import { Client } from 'pg';

// Identicos aos de HashService: um hash gerado com outros parametros ainda
// seria verificavel pelo argon2 (eles vao embutidos na string), mas divergir
// aqui esconderia uma diferenca real de custo entre as contas.
const OPCOES_HASH = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const vermelho = (t) => `\x1b[31m${t}\x1b[0m`;
const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const cinza = (t) => `\x1b[90m${t}\x1b[0m`;

function lerArgumentos(argv) {
  const valores = {};

  for (let i = 0; i < argv.length; i += 1) {
    const atual = argv[i];

    /**
     * Argumento solto e erro, nao algo a ignorar.
     *
     * `--nome Joao Ribeiro` sem aspas chegaria aqui como tres argumentos, e
     * ignorar o terceiro gravaria um professor chamado "Joao" em silencio — num
     * script que escreve direto no banco e nao tem tela de confirmacao.
     */
    if (!atual.startsWith('--')) {
      abortar(
        `Argumento solto: "${atual}". Valores com espaco precisam de aspas, ` +
          'por exemplo --nome "Joao Ribeiro".',
      );
    }

    const chave = atual.slice(2);
    const proximo = argv[i + 1];

    if (proximo === undefined || proximo.startsWith('--')) {
      abortar(`--${chave} precisa de um valor.`);
    }

    valores[chave] = proximo;
    i += 1;
  }

  return valores;
}

function abortar(mensagem) {
  console.error(`\n${vermelho('ERRO')} ${mensagem}\n`);
  process.exit(1);
}

/**
 * Mesma regra do UsuariosService.validarDominioDoEmail.
 *
 * Duplicada de proposito: o script nao sobe o Nest (seria caro e exigiria a
 * aplicacao inteira valida para criar uma linha), mas deixar a restricao de fora
 * criaria uma porta dos fundos justamente no usuario mais privilegiado.
 */
function validarDominio(email) {
  const permitidos = (process.env.EMAIL_DOMINIOS_PERMITIDOS ?? '')
    .split(',')
    .map((dominio) => dominio.trim().toLowerCase())
    .filter(Boolean);

  if (permitidos.length === 0) {
    return;
  }

  const dominio = email.split('@')[1];

  if (!permitidos.includes(dominio)) {
    abortar(
      `E-mail fora dos dominios institucionais permitidos (${permitidos.join(', ')}). ` +
        'Ajuste EMAIL_DOMINIOS_PERMITIDOS ou use outro e-mail.',
    );
  }
}

async function main() {
  const args = lerArgumentos(process.argv.slice(2));

  const nome = (args.nome ?? process.env.PROFESSOR_NOME ?? '').trim();
  const email = (args.email ?? process.env.PROFESSOR_EMAIL ?? '').trim().toLowerCase();
  const identificacaoFuncional = (args.identificacao ?? '').trim() || null;
  const departamento = (args.departamento ?? '').trim() || null;

  if (nome.length < 3) {
    abortar('Informe --nome com pelo menos 3 caracteres.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    abortar('Informe --email com um endereco valido.');
  }

  validarDominio(email);

  // Sem senha informada, uma aleatoria e melhor que uma padrao: ninguem fica
  // tentado a reaproveitar a mesma em todas as instalacoes.
  const senhaGerada = !args.senha && !process.env.PROFESSOR_SENHA;
  const senha = args.senha ?? process.env.PROFESSOR_SENHA ?? randomBytes(9).toString('base64url');

  if (senha.length < 8) {
    abortar('A senha precisa ter pelo menos 8 caracteres.');
  }

  const cliente = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await cliente.connect();
  } catch (erro) {
    abortar(`Nao foi possivel conectar ao banco: ${erro.message}`);
  }

  try {
    const { rows: existentes } = await cliente.query('SELECT id FROM usuarios');

    if (existentes.length > 0) {
      abortar(`Usuario ja cadastrado`);
    }

    const id = randomUUID();
    const senhaHash = await argon2.hash(senha, OPCOES_HASH);

    /**
     * Transacao pelo mesmo motivo do UsuariosService: se `professores` falhar
     * (identificacao funcional duplicada, por exemplo), um `usuarios` orfao
     * ficaria para tras — uma conta que loga e nao e aluno nem professor.
     *
     * `criado_por_usuario_id` fica NULL: nao houve autor. E o unico caminho em
     * que isso acontece, e e o que distingue uma conta de bootstrap das demais.
     */
    await cliente.query('BEGIN');

    await cliente.query(
      `INSERT INTO usuarios (id, nome, email, senha_hash, ativo, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, now(), now())`,
      [id, nome, email, senhaHash],
    );

    await cliente.query(
      `INSERT INTO professores
         (usuario_id, identificacao_funcional, departamento, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [id, identificacaoFuncional, departamento],
    );

    await cliente.query('COMMIT');

    console.log(`\n${verde('OK')} Professor criado.\n`);
    console.log(`  id:    ${id}`);
    console.log(`  nome:  ${nome}`);
    console.log(`  email: ${email}`);

    if (senhaGerada) {
      console.log(`  senha: ${senha}`);
      console.log(cinza('\n  Esta senha nao sera exibida de novo. Troque-a no primeiro acesso em'));
      console.log(cinza('  PATCH /api/usuarios/eu/senha.'));
    } else {
      console.log(cinza('\n  Troque a senha no primeiro acesso em PATCH /api/usuarios/eu/senha.'));
    }

    console.log('');
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => {});
    abortar(erro.message);
  } finally {
    await cliente.end();
  }
}

main();
