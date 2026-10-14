/**
 * Verificacao ponta a ponta do nucleo funcional (fases 2 e 3).
 *
 * Percorre o fluxo completo do dominio e, alem do caminho feliz, tenta violar as
 * regras de negocio para confirmar que o BACKEND as recusa:
 *
 *   professor cria monitoria -> habilita monitor -> aluno se inscreve ->
 *   monitor declara disponibilidade -> monitorado agenda -> atendimento e
 *   realizado -> tudo permanece no historico.
 *
 * Uso:
 *   1. npm run db:migrate
 *   2. npm run db:seed     (cria o professor de bootstrap)
 *   3. npm run start:dev   (em outro terminal)
 *   4. npm run test:fluxo
 *
 * O passo 2 passou a ser obrigatorio quando o auto-cadastro foi removido: criar
 * usuario exige um professor autenticado, e o script nao tem como fabricar o
 * primeiro pela API — e exatamente a restricao que ele verifica. Em uma base
 * nova sem seeder, use `npm run criar-professor` e ajuste as constantes abaixo.
 *
 * O script nao altera dados existentes: cria os proprios usuarios com sufixo
 * aleatorio a cada execucao.
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { Client } from 'pg';

const BASE = process.env.API_BASE ?? 'http://localhost:3000/api';
const TZ = process.env.TIMEZONE_INSTITUICAO ?? 'America/Porto_Velho';
const SUFIXO = Date.now().toString(36);
const SENHA = 'senhaSegura123';

/** Identicas as de HashService: o hash precisa ser aceito pela aplicacao. */
const OPCOES_ARGON2 = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Professor de bootstrap, vindo do seeder de desenvolvimento.
 *
 * Nenhuma conta nasce pela API sem um professor autenticado, entao o script
 * precisa de um ponto de partida que a API nao oferece. Ele e usado apenas para
 * criar o professor desta execucao; o resto do fluxo nao o toca.
 */
const EMAIL_BOOTSTRAP = process.env.FLUXO_EMAIL_PROFESSOR ?? 'joao.ribeiro@ufx.edu.br';
const SENHA_BOOTSTRAP = process.env.FLUXO_SENHA_PROFESSOR ?? 'senhaSegura123';

let passos = 0;
let falhas = 0;

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const vermelho = (t) => `\x1b[31m${t}\x1b[0m`;
const cinza = (t) => `\x1b[90m${t}\x1b[0m`;

function ok(descricao, detalhe = '') {
  passos += 1;
  console.log(`${verde('  OK  ')} ${descricao} ${detalhe ? cinza(detalhe) : ''}`);
}

function falhou(descricao, detalhe = '') {
  passos += 1;
  falhas += 1;
  console.log(`${vermelho(' FALHA')} ${descricao} ${detalhe ? cinza(detalhe) : ''}`);
}

function secao(titulo) {
  console.log(`\n\x1b[1m${titulo}\x1b[0m`);
}

async function api(metodo, caminho, { token, corpo } = {}) {
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });

  const texto = await resposta.text();
  let dados = null;

  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = texto;
  }

  return { status: resposta.status, dados };
}

/** Espera sucesso. Aborta o script se a etapa do caminho feliz falhar. */
async function esperarSucesso(descricao, promessa) {
  const { status, dados } = await promessa;

  if (status >= 200 && status < 300) {
    ok(descricao, `HTTP ${status}`);
    return dados;
  }

  falhou(descricao, `HTTP ${status} - ${dados?.mensagem ?? JSON.stringify(dados)}`);
  throw new Error(`Etapa obrigatoria falhou: ${descricao}`);
}

/** Espera recusa. E aqui que as regras de negocio sao realmente verificadas. */
async function esperarRecusa(descricao, statusEsperado, promessa) {
  const { status, dados } = await promessa;

  if (status === statusEsperado) {
    ok(descricao, `HTTP ${status} - ${dados?.mensagem ?? ''}`);
    return;
  }

  falhou(descricao, `esperava HTTP ${statusEsperado}, veio ${status} - ${JSON.stringify(dados)}`);
}

async function logar(descricao, email, senha) {
  const login = await esperarSucesso(
    descricao,
    api('POST', '/auth/login', { corpo: { email, senha } }),
  );

  return { token: login.tokenDeAcesso, id: login.usuario.id, email };
}

/**
 * Cria a conta COMO PROFESSOR e loga nela.
 *
 * Nao existe auto-cadastro: toda identidade deste fluxo e criada por um
 * professor autenticado, em POST /alunos ou POST /professores.
 *
 * Quem cria NAO escolhe a senha — o servidor gera uma aleatoria e a manda para
 * o e-mail da pessoa. O script, portanto, nao tem como saber a senha das contas
 * que cria: ele SOBRESCREVE o hash no banco por um de senha conhecida, o mesmo
 * artificio usado em viajarNoTempo e na recuperacao de senha. Nada do que o
 * fluxo verifica depois depende de qual senha foi gravada.
 */
async function criarELogar(tipo, nome, tokenDeQuemCria, extra = {}) {
  const email = `${nome.toLowerCase().replace(/\s+/g, '.')}.${SUFIXO}@ufx.edu.br`;
  const rota = tipo === 'aluno' ? '/alunos' : '/professores';

  await esperarSucesso(
    `Professor cadastra ${tipo}: ${nome}`,
    api('POST', rota, { token: tokenDeQuemCria, corpo: { nome, email, ...extra } }),
  );

  await definirSenhaConhecida(email);

  const login = await esperarSucesso(
    `Login de ${nome}`,
    api('POST', '/auth/login', { corpo: { email, senha: SENHA } }),
  );

  return { token: login.tokenDeAcesso, id: login.usuario.id, nome, email };
}

/**
 * Escolhe um instante futuro cujo horario LOCAL da instituicao caia em horario
 * comercial, e devolve o dia da semana e a hora local correspondentes.
 *
 * A conversao usa Intl com o fuso da instituicao para que o script funcione
 * independentemente do fuso da maquina que o executa — o mesmo cuidado que o
 * backend toma ao validar a janela de disponibilidade.
 */
function escolherHorario() {
  for (let horasAFrente = 24; horasAFrente < 72; horasAFrente += 1) {
    const instante = new Date(Date.now() + horasAFrente * 3600_000);
    instante.setUTCMinutes(0, 0, 0);

    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(instante);

    const diaTexto = partes.find((p) => p.type === 'weekday').value;
    const hora = Number(partes.find((p) => p.type === 'hour').value);

    const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    if (hora >= 9 && hora <= 17) {
      return {
        inicio: instante,
        fim: new Date(instante.getTime() + 60 * 60_000),
        diaSemana: dias[diaTexto],
        horaInicioFaixa: `${String(hora - 1).padStart(2, '0')}:00`,
        horaFimFaixa: `${String(hora + 2).padStart(2, '0')}:00`,
        horaLocal: hora,
      };
    }
  }

  throw new Error('Nao foi possivel escolher um horario comercial.');
}

/**
 * Artificio de teste: empurra o atendimento para o passado direto no banco.
 *
 * Marcar como REALIZADO exige que a sessao ja tenha comecado, e nao da para
 * esperar horas dentro de um script. De quebra, isto exercita a FK composta com
 * ON UPDATE CASCADE: ao mudar inicio/fim do atendimento, o PostgreSQL propaga
 * sozinho os mesmos valores para as inscricoes.
 */
/**
 * Artificio de teste: grava uma senha conhecida direto no banco.
 *
 * A senha gerada na criacao so existe no e-mail da pessoa. Sem isto o script
 * nao conseguiria autenticar nenhuma das contas que ele mesmo cria.
 */
async function definirSenhaConhecida(email) {
  const cliente = await conectarAoBanco();

  try {
    await cliente.query('UPDATE usuarios SET senha_hash = $1 WHERE email = $2', [
      await argon2.hash(SENHA, OPCOES_ARGON2),
      email,
    ]);
  } finally {
    await cliente.end();
  }
}

/** Abre conexao direta com o banco. Usado pelos artificios de teste. */
async function conectarAoBanco() {
  const cliente = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await cliente.connect();
  return cliente;
}

async function viajarNoTempo(atendimentoId) {
  const cliente = await conectarAoBanco();

  await cliente.query(
    `UPDATE atendimentos
        SET inicio = now() - interval '2 hours',
            fim    = now() - interval '1 hour'
      WHERE id = $1`,
    [atendimentoId],
  );

  const { rows } = await cliente.query(
    `SELECT inicio, fim FROM atendimento_participantes WHERE atendimento_id = $1`,
    [atendimentoId],
  );

  await cliente.end();
  return rows;
}

async function main() {
  console.log(`\n\x1b[1mFluxo completo — nucleo da plataforma de monitoria\x1b[0m`);
  console.log(cinza(`API: ${BASE} | fuso: ${TZ} | execucao: ${SUFIXO}\n`));

  secao('1. Atores — nenhuma conta nasce sozinha');

  /**
   * O professor que conduz o fluxo e o de bootstrap, nao um criado aqui.
   *
   * Nao e preguica: /auth/login aceita 5 tentativas por minuto por IP, e o
   * fluxo precisa de quatro sessoes (professor + tres alunos). Logar em um
   * quinto usuario estouraria o teto e a falha pareceria regressao. A rota
   * POST /professores e exercitada logo abaixo, sem consumir um login.
   */
  const professor = await logar(
    'Login do professor de bootstrap (seeder ou npm run criar-professor)',
    EMAIL_BOOTSTRAP,
    SENHA_BOOTSTRAP,
  );

  /**
   * As tres recusas abaixo sao o ponto da secao: criar conta e operacao de
   * professor autenticado, e so isso. Se o auto-cadastro voltar, as duas
   * primeiras passam a responder 201 e o fluxo acusa na hora.
   */
  await esperarRecusa(
    'Auto-cadastro de aluno NAO existe mais (404)',
    404,
    api('POST', '/auth/registro/aluno', {
      corpo: {
        nome: 'Intruso Um',
        email: `intruso1.${SUFIXO}@ufx.edu.br`,
        senha: SENHA,
        matricula: `I1${SUFIXO}`,
      },
    }),
  );

  await esperarRecusa(
    'Auto-cadastro de professor NAO existe mais (404)',
    404,
    api('POST', '/auth/registro/professor', {
      corpo: { nome: 'Intruso Dois', email: `intruso2.${SUFIXO}@ufx.edu.br`, senha: SENHA },
    }),
  );

  await esperarRecusa(
    'Criar aluno sem token e recusado (401)',
    401,
    api('POST', '/alunos', {
      corpo: { nome: 'Anonimo Tres', email: `anon.${SUFIXO}@ufx.edu.br`, matricula: `A0${SUFIXO}` },
    }),
  );

  await esperarSucesso(
    'Professor cadastra outro professor (unico caminho pela API)',
    api('POST', '/professores', {
      token: professor.token,
      corpo: {
        nome: 'Prof Maria',
        email: `prof.maria.${SUFIXO}@ufx.edu.br`,
        identificacaoFuncional: `SIAPE${SUFIXO}`,
        departamento: 'Computacao',
      },
    }),
  );

  /**
   * O professor nao escolhe a senha. Mandar uma nao e ignorado em silencio: o
   * `forbidNonWhitelisted` recusa, o que evita a ilusao de que a senha enviada
   * vale alguma coisa.
   */
  await esperarRecusa(
    'Professor NAO pode escolher a senha do usuario (400)',
    400,
    api('POST', '/alunos', {
      token: professor.token,
      corpo: {
        nome: 'Senha Escolhida',
        email: `escolhida.${SUFIXO}@ufx.edu.br`,
        matricula: `S1${SUFIXO}`,
        senhaProvisoria: 'euEscolhi123',
      },
    }),
  );

  const monitora = await criarELogar('aluno', 'Ana Monitora', professor.token, {
    matricula: `M${SUFIXO}`,
    curso: 'Ciencia da Computacao',
  });
  const monitorado = await criarELogar('aluno', 'Bruno Aluno', professor.token, {
    matricula: `A${SUFIXO}`,
    curso: 'Engenharia',
  });
  const estranho = await criarELogar('aluno', 'Carla Externa', professor.token, {
    matricula: `X${SUFIXO}`,
  });

  /**
   * A regressao mais grave que o fechamento previne: um aluno capaz de criar
   * professor se promoveria sozinho e passaria a habilitar monitores (RN01).
   */
  await esperarRecusa(
    'RN: aluno NAO pode criar professor (403)',
    403,
    api('POST', '/professores', {
      token: monitorado.token,
      corpo: { nome: 'Auto Promovido', email: `promovido.${SUFIXO}@ufx.edu.br` },
    }),
  );

  await esperarRecusa(
    'RN: aluno NAO pode criar aluno (403)',
    403,
    api('POST', '/alunos', {
      token: monitorado.token,
      corpo: {
        nome: 'Colega Convidado',
        email: `colega.${SUFIXO}@ufx.edu.br`,
        matricula: `C1${SUFIXO}`,
      },
    }),
  );

  secao('2. Professor cria a monitoria');
  const disciplina = await esperarSucesso(
    'Professor cadastra a disciplina (so o nome)',
    api('POST', '/disciplinas', { token: professor.token, corpo: { nome: 'Calculo I' } }),
  );

  if (/^CAL\d{3,}$/.test(disciplina.codigo)) {
    ok('Codigo gerado a partir do nome', disciplina.codigo);
  } else {
    falhou('Codigo gerado fora do formato esperado', disciplina.codigo);
  }

  /**
   * Duas disciplinas de mesmo nome e o caso que mais ameaca a unicidade: o
   * prefixo e identico, entao so a numeracao as separa.
   */
  const homonima = await esperarSucesso(
    'Disciplina de nome identico tambem e aceita',
    api('POST', '/disciplinas', { token: professor.token, corpo: { nome: 'Calculo I' } }),
  );

  if (homonima.codigo !== disciplina.codigo) {
    ok('Nomes iguais produzem codigos diferentes', `${disciplina.codigo} != ${homonima.codigo}`);
  } else {
    falhou('Codigo repetido entre disciplinas de mesmo nome', homonima.codigo);
  }

  await esperarRecusa(
    'Professor NAO pode escolher o codigo da disciplina (400)',
    400,
    api('POST', '/disciplinas', {
      token: professor.token,
      corpo: { codigo: `MEU${SUFIXO.slice(-4)}`, nome: 'Codigo Escolhido' },
    }),
  );

  await esperarRecusa(
    'RN: aluno NAO pode cadastrar disciplina (403)',
    403,
    api('POST', '/disciplinas', { token: monitorado.token, corpo: { nome: 'Invalida' } }),
  );

  const monitoria = await esperarSucesso(
    'Professor cria a monitoria (nasce PLANEJADA)',
    api('POST', '/monitorias', {
      token: professor.token,
      corpo: { disciplinaId: disciplina.id, ano: 2026, semestre: 2, descricao: 'Apoio a listas.' },
    }),
  );

  await esperarSucesso(
    'Professor ativa a monitoria (PLANEJADA -> ATIVA)',
    api('POST', `/monitorias/${monitoria.id}/ativar`, { token: professor.token }),
  );

  secao('3. Participantes — papeis dentro da monitoria');
  const vinculoMonitora = await esperarSucesso(
    'Professor habilita Ana como MONITOR (RN01)',
    api('POST', `/monitorias/${monitoria.id}/monitores`, {
      token: professor.token,
      corpo: { alunoId: monitora.id },
    }),
  );

  await esperarRecusa(
    'RN01: aluno NAO pode habilitar a si mesmo como monitor (403)',
    403,
    api('POST', `/monitorias/${monitoria.id}/monitores`, {
      token: monitorado.token,
      corpo: { alunoId: monitorado.id },
    }),
  );

  await esperarSucesso(
    'Bruno se inscreve como MONITORADO (RN04)',
    api('POST', `/monitorias/${monitoria.id}/inscricao`, { token: monitorado.token }),
  );

  await esperarRecusa(
    'RN09: Ana ja e MONITOR, nao pode virar MONITORADO na mesma monitoria (409)',
    409,
    api('POST', `/monitorias/${monitoria.id}/inscricao`, { token: monitora.token }),
  );

  await esperarRecusa(
    'RN07: aluno de fora nao ve os participantes (403)',
    403,
    api('GET', `/monitorias/${monitoria.id}/participantes`, { token: estranho.token }),
  );

  secao('4. Disponibilidade do monitor');
  const horario = escolherHorario();
  console.log(
    cinza(
      `      alvo: ${horario.inicio.toISOString()} | dia ${horario.diaSemana} | ` +
        `${horario.horaLocal}h local (${TZ})`,
    ),
  );

  await esperarSucesso(
    `Ana declara disponibilidade (dia ${horario.diaSemana}, ${horario.horaInicioFaixa}-${horario.horaFimFaixa})`,
    api('POST', `/monitorias/${monitoria.id}/disponibilidades`, {
      token: monitora.token,
      corpo: {
        diaSemana: horario.diaSemana,
        horaInicio: horario.horaInicioFaixa,
        horaFim: horario.horaFimFaixa,
      },
    }),
  );

  await esperarRecusa(
    'Faixa sobreposta e recusada pela constraint EXCLUDE (409)',
    409,
    api('POST', `/monitorias/${monitoria.id}/disponibilidades`, {
      token: monitora.token,
      corpo: {
        diaSemana: horario.diaSemana,
        horaInicio: horario.horaInicioFaixa,
        horaFim: horario.horaFimFaixa,
      },
    }),
  );

  await esperarRecusa(
    'Intervalo invalido (fim <= inicio) e recusado (400)',
    400,
    api('POST', `/monitorias/${monitoria.id}/disponibilidades`, {
      token: monitora.token,
      corpo: { diaSemana: 1, horaInicio: '16:00', horaFim: '15:00' },
    }),
  );

  await esperarRecusa(
    'Monitorado NAO pode declarar disponibilidade de monitor (403)',
    403,
    api('POST', `/monitorias/${monitoria.id}/disponibilidades`, {
      token: monitorado.token,
      corpo: { diaSemana: horario.diaSemana, horaInicio: '08:00', horaFim: '09:00' },
    }),
  );

  secao('5. Agendamento');
  const atendimento = await esperarSucesso(
    'Bruno agenda atendimento dentro da janela da Ana',
    api('POST', `/monitorias/${monitoria.id}/atendimentos`, {
      token: monitorado.token,
      corpo: {
        monitorParticipanteId: vinculoMonitora.id,
        inicio: horario.inicio.toISOString(),
        fim: horario.fim.toISOString(),
        assunto: 'Duvidas sobre limites',
        modalidade: 'REMOTO',
        local: 'https://meet.exemplo/abc',
      },
    }),
  );

  await esperarRecusa(
    'RN03: mesmo aluno nao agenda horario sobreposto (409)',
    409,
    api('POST', `/monitorias/${monitoria.id}/atendimentos`, {
      token: monitorado.token,
      corpo: {
        monitorParticipanteId: vinculoMonitora.id,
        inicio: new Date(horario.inicio.getTime() + 30 * 60_000).toISOString(),
        fim: new Date(horario.fim.getTime() + 30 * 60_000).toISOString(),
        assunto: 'Sobreposto',
        modalidade: 'REMOTO',
      },
    }),
  );

  await esperarRecusa(
    'Agendamento fora da disponibilidade do monitor e recusado (409)',
    409,
    api('POST', `/monitorias/${monitoria.id}/atendimentos`, {
      token: monitorado.token,
      corpo: {
        monitorParticipanteId: vinculoMonitora.id,
        inicio: new Date(horario.inicio.getTime() + 6 * 3600_000).toISOString(),
        fim: new Date(horario.inicio.getTime() + 7 * 3600_000).toISOString(),
        assunto: 'Fora da janela',
        modalidade: 'REMOTO',
      },
    }),
  );

  await esperarRecusa(
    'RN04: aluno que nao participa nao agenda nesta monitoria (403)',
    403,
    api('POST', `/monitorias/${monitoria.id}/atendimentos`, {
      token: estranho.token,
      corpo: {
        monitorParticipanteId: vinculoMonitora.id,
        inicio: horario.inicio.toISOString(),
        fim: horario.fim.toISOString(),
        assunto: 'Nao participo',
        modalidade: 'REMOTO',
      },
    }),
  );

  await esperarRecusa(
    'Agendamento no passado e recusado (400)',
    400,
    api('POST', `/monitorias/${monitoria.id}/atendimentos`, {
      token: monitorado.token,
      corpo: {
        monitorParticipanteId: vinculoMonitora.id,
        inicio: new Date(Date.now() - 7200_000).toISOString(),
        fim: new Date(Date.now() - 3600_000).toISOString(),
        assunto: 'Passado',
        modalidade: 'REMOTO',
      },
    }),
  );

  await esperarRecusa(
    'RN07: aluno de fora nao consulta o atendimento (403)',
    403,
    api('GET', `/atendimentos/${atendimento.id}`, { token: estranho.token }),
  );

  secao('6. Realizacao');
  const inscricoes = await viajarNoTempo(atendimento.id);
  const propagou = inscricoes.length > 0 && new Date(inscricoes[0].inicio) < new Date();

  if (propagou) {
    ok('ON UPDATE CASCADE propagou o novo horario para a inscricao', 'sem trigger, sem codigo');
  } else {
    falhou('ON UPDATE CASCADE nao propagou o horario para a inscricao');
  }

  await esperarRecusa(
    'Monitorado NAO pode declarar que foi atendido (403)',
    403,
    api('POST', `/atendimentos/${atendimento.id}/realizar`, { token: monitorado.token, corpo: {} }),
  );

  const realizado = await esperarSucesso(
    'Ana marca o atendimento como REALIZADO (presenca registrada)',
    api('POST', `/atendimentos/${atendimento.id}/realizar`, { token: monitora.token, corpo: {} }),
  );

  if (realizado.status === 'REALIZADO' && realizado.inscricoes?.[0]?.status === 'PRESENTE') {
    ok('Atendimento REALIZADO e inscricao PRESENTE');
  } else {
    falhou('Status inesperado apos realizar', JSON.stringify(realizado.status));
  }

  await esperarRecusa(
    'Nao e possivel realizar duas vezes (409)',
    409,
    api('POST', `/atendimentos/${atendimento.id}/realizar`, { token: monitora.token, corpo: {} }),
  );

  secao('7. Cancelamento e historico (RN10)');
  const segundo = await esperarSucesso(
    'Ana abre uma sessao coletiva (2 vagas)',
    api('POST', `/monitorias/${monitoria.id}/atendimentos`, {
      token: monitora.token,
      corpo: {
        // +7 dias: mesma faixa semanal declarada pela Ana. Somar 24h cairia em
        // outro dia da semana e seria (corretamente) recusado pelo backend.
        inicio: new Date(horario.inicio.getTime() + 7 * 24 * 3600_000).toISOString(),
        fim: new Date(horario.fim.getTime() + 7 * 24 * 3600_000).toISOString(),
        assunto: 'Plantao de duvidas',
        modalidade: 'PRESENCIAL',
        local: 'Sala 203',
        vagas: 2,
      },
    }),
  );

  await esperarSucesso(
    'Bruno se inscreve na sessao coletiva',
    api('POST', `/atendimentos/${segundo.id}/inscricao`, { token: monitorado.token }),
  );

  await esperarRecusa(
    'Inscricao duplicada e recusada (409)',
    409,
    api('POST', `/atendimentos/${segundo.id}/inscricao`, { token: monitorado.token }),
  );

  await esperarSucesso(
    'Ana cancela a sessao com motivo',
    api('POST', `/atendimentos/${segundo.id}/cancelar`, {
      token: monitora.token,
      corpo: { motivo: 'Monitora ficou doente.' },
    }),
  );

  const cancelado = await esperarSucesso(
    'RN10: o atendimento cancelado CONTINUA no banco',
    api('GET', `/atendimentos/${segundo.id}`, { token: monitora.token }),
  );

  if (cancelado.status === 'CANCELADO' && cancelado.motivoCancelamento) {
    ok('Cancelado com motivo preservado', cancelado.motivoCancelamento);
  } else {
    falhou('Cancelamento nao preservou o motivo');
  }

  const historico = await esperarSucesso(
    'Historico de status do atendimento cancelado',
    api('GET', `/atendimentos/${segundo.id}/historico`, { token: monitora.token }),
  );

  const trilha = historico
    .map((h) => `${h.statusAnterior ?? 'inicio'}->${h.statusNovo}`)
    .join(', ');

  if (historico.length === 2) {
    ok('Trilha completa de transicoes', trilha);
  } else {
    falhou(`Esperava 2 transicoes, veio ${historico.length}`, trilha);
  }

  secao('8. O papel e contextual, nao um tipo de usuario');
  const minhasAna = await esperarSucesso(
    'Monitorias da Ana',
    api('GET', '/monitorias/minhas', { token: monitora.token }),
  );
  const minhasBruno = await esperarSucesso(
    'Monitorias do Bruno',
    api('GET', '/monitorias/minhas', { token: monitorado.token }),
  );

  // /monitorias/minhas passou a ser paginado: { dados, meta }.
  const linhaAna = minhasAna.dados.find((m) => m.id === monitoria.id);
  const linhaBruno = minhasBruno.dados.find((m) => m.id === monitoria.id);

  if (linhaAna?.meuPapel === 'MONITOR' && linhaBruno?.meuPapel === 'MONITORADO') {
    ok('Mesma monitoria, papeis distintos por pessoa', 'Ana=MONITOR, Bruno=MONITORADO');
  } else {
    falhou('Papeis inesperados', `${linhaAna?.meuPapel} / ${linhaBruno?.meuPapel}`);
  }

  if (minhasAna.meta && typeof minhasAna.meta.total === 'number') {
    ok('Resposta paginada traz meta', `total=${minhasAna.meta.total}`);
  } else {
    falhou('Resposta de /minhas sem meta de paginacao');
  }

  // B7: o id do VINCULO, que varias rotas exigem, ja vem pronto.
  if (linhaAna?.meuParticipanteId === vinculoMonitora.id) {
    ok('meuParticipanteId dispensa procurar o proprio vinculo em /participantes');
  } else {
    falhou('meuParticipanteId ausente ou incorreto', String(linhaAna?.meuParticipanteId));
  }

  await esperarSucesso(
    'Historico acessivel pedindo os status terminais',
    api('GET', '/monitorias/minhas?status=ENCERRADA&status=CANCELADA', { token: monitora.token }),
  );

  secao('8b. Avaliacao do atendimento realizado');
  const realizadoDetalhe = await esperarSucesso(
    'Bruno consulta o atendimento realizado',
    api('GET', `/atendimentos/${atendimento.id}`, { token: monitorado.token }),
  );

  const minhaInscricao = realizadoDetalhe.inscricoes.find((i) => i.souEu);

  if (minhaInscricao?.podeAvaliar === true && minhaInscricao?.jaAvaliei === false) {
    ok('podeAvaliar sinaliza o botao antes de o usuario tentar (B3)');
  } else {
    falhou('Marcas de avaliacao ausentes', JSON.stringify(minhaInscricao));
  }

  await esperarRecusa(
    'RN05: quem nao participou do atendimento nao avalia (403)',
    403,
    api('POST', `/atendimentos/${atendimento.id}/avaliacao`, {
      token: estranho.token,
      corpo: { nota: 1 },
    }),
  );

  await esperarSucesso(
    'Bruno avalia o atendimento realizado',
    api('POST', `/atendimentos/${atendimento.id}/avaliacao`, {
      token: monitorado.token,
      corpo: { nota: 5, comentario: 'Explicou com clareza.' },
    }),
  );

  await esperarRecusa(
    'Avaliacao duplicada e recusada (409)',
    409,
    api('POST', `/atendimentos/${atendimento.id}/avaliacao`, {
      token: monitorado.token,
      corpo: { nota: 3 },
    }),
  );

  const aposAvaliar = await esperarSucesso(
    'Atendimento reconsultado apos avaliar',
    api('GET', `/atendimentos/${atendimento.id}`, { token: monitorado.token }),
  );

  const inscricaoApos = aposAvaliar.inscricoes.find((i) => i.souEu);

  if (inscricaoApos?.jaAvaliei === true && inscricaoApos?.podeAvaliar === false) {
    ok('jaAvaliei/podeAvaliar refletem a avaliacao registrada');
  } else {
    falhou('Marcas nao atualizaram', JSON.stringify(inscricaoApos));
  }

  await esperarRecusa(
    'RN06: atendimento CANCELADO nao pode ser avaliado (409)',
    409,
    api('POST', `/atendimentos/${segundo.id}/avaliacao`, {
      token: monitorado.token,
      corpo: { nota: 4 },
    }),
  );

  secao('8c. Gamificacao — extrato e ranking precisam bater (A1)');
  const meusPontos = await esperarSucesso(
    'Extrato de pontos da Ana',
    api('GET', '/gamificacao/meus-pontos', { token: monitora.token }),
  );

  const ranking = await esperarSucesso(
    'Ranking geral',
    api('GET', '/gamificacao/ranking', { token: monitora.token }),
  );

  const anaNoRanking = ranking.find((p) => p.usuarioId === monitora.id);

  if (anaNoRanking && anaNoRanking.pontos === meusPontos.total) {
    ok('Extrato e ranking mostram o MESMO total', `${meusPontos.total} pontos`);
  } else {
    falhou(
      'Extrato e ranking divergem',
      `extrato=${meusPontos.total} ranking=${anaNoRanking?.pontos}`,
    );
  }

  // 10 (atendimento realizado) + 5 (nota da avaliacao) = 15
  if (
    meusPontos.porTipo.ATENDIMENTO_REALIZADO === 10 &&
    meusPontos.porTipo.AVALIACAO_RECEBIDA === 5
  ) {
    ok('Pontuacao por evento conforme a tabela', JSON.stringify(meusPontos.porTipo));
  } else {
    falhou('Pontuacao inesperada', JSON.stringify(meusPontos.porTipo));
  }

  secao('8d. Busca (B1/B2) e agenda cross-monitoria (B6)');
  const buscaAlunos = await esperarSucesso(
    'Professor busca aluno por nome',
    api('GET', '/alunos?busca=Bruno', { token: professor.token }),
  );

  if (buscaAlunos.dados.some((a) => a.id === monitorado.id)) {
    ok('Busca localiza o aluno para o fluxo da RN01');
  } else {
    falhou('Busca nao encontrou o aluno');
  }

  const candidatos = await esperarSucesso(
    'Candidatos a monitor excluem quem ja participa',
    api('GET', `/alunos?semVinculoAtivoNaMonitoria=${monitoria.id}`, { token: professor.token }),
  );

  const jaParticipam = candidatos.dados.filter(
    (a) => a.id === monitora.id || a.id === monitorado.id,
  );

  if (jaParticipam.length === 0) {
    ok('Ana e Bruno fora da lista de candidatos (evita 409 de RN09)');
  } else {
    falhou('Filtro nao excluiu participantes ativos');
  }

  const buscaMonitorias = await esperarSucesso(
    'Aluno busca monitoria por nome de disciplina',
    api('GET', '/monitorias?busca=Calculo', { token: monitorado.token }),
  );

  if (buscaMonitorias.dados.some((m) => m.id === monitoria.id)) {
    ok('Busca textual encontra a monitoria sem passar por /disciplinas');
  } else {
    falhou('Busca textual nao encontrou a monitoria');
  }

  const agenda = await esperarSucesso(
    'Agenda cross-monitoria do Bruno',
    api('GET', '/atendimentos/meus', { token: monitorado.token }),
  );

  const comDisciplina = agenda.dados.find((a) => a.monitoria?.nomeDisciplina);

  if (comDisciplina) {
    ok('Atendimento traz a disciplina legivel (sem N+1)', comDisciplina.monitoria.nomeDisciplina);
  } else {
    falhou('Atendimento sem resumo da monitoria');
  }

  secao('8e. Materiais — acesso, publicacao e remocao (RN07/RN08)');
  const materialDoProfessor = await esperarSucesso(
    'Professor publica material',
    api('POST', `/monitorias/${monitoria.id}/materiais`, {
      token: professor.token,
      corpo: { titulo: 'Ementa da disciplina', url: 'https://exemplo.com/ementa.pdf' },
    }),
  );

  await esperarSucesso(
    'Monitor publica material (RN08)',
    api('POST', `/monitorias/${monitoria.id}/materiais`, {
      token: monitora.token,
      corpo: {
        titulo: 'Lista de exercicios - Limites',
        descricao: 'Exercicios 1 a 20.',
        url: 'https://exemplo.com/lista-limites.pdf',
      },
    }),
  );

  await esperarRecusa(
    'RN08: MONITORADO nao publica material (403)',
    403,
    api('POST', `/monitorias/${monitoria.id}/materiais`, {
      token: monitorado.token,
      corpo: { titulo: 'Nao deveria existir', url: 'https://exemplo.com/x.pdf' },
    }),
  );

  await esperarRecusa(
    'RN07: aluno de fora nao acessa o acervo (403)',
    403,
    api('GET', `/monitorias/${monitoria.id}/materiais`, { token: estranho.token }),
  );

  await esperarRecusa(
    'URL nao-http e recusada (evita XSS via javascript:) (400)',
    400,
    api('POST', `/monitorias/${monitoria.id}/materiais`, {
      token: professor.token,
      corpo: { titulo: 'Malicioso', url: 'javascript:alert(1)' },
    }),
  );

  /**
   * Regressao: a listagem combinava `@Query() dto` com `@Query('incluirRemovidos')`
   * avulso. Como o ValidationPipe valida o objeto de query INTEIRO contra o DTO e
   * `forbidNonWhitelisted` esta ligado, passar o parametro documentado derrubava a
   * requisicao com 400. Nenhum teste unitario pegava isso: o pipe so roda em
   * requisicao HTTP real.
   */
  const listaComFiltros = await esperarSucesso(
    'Listagem aceita os parametros documentados juntos',
    api('GET', `/monitorias/${monitoria.id}/materiais?incluirRemovidos=false&pagina=1&limite=20`, {
      token: monitorado.token,
    }),
  );

  if (listaComFiltros.dados.length === 2 && listaComFiltros.meta.total === 2) {
    ok('Monitorado ve os dois materiais publicados', `total=${listaComFiltros.meta.total}`);
  } else {
    falhou('Quantidade inesperada de materiais', JSON.stringify(listaComFiltros.meta));
  }

  await esperarSucesso(
    'Professor remove o proprio material',
    api('POST', `/monitorias/${monitoria.id}/materiais/${materialDoProfessor.id}/remover`, {
      token: professor.token,
    }),
  );

  const listaPadrao = await esperarSucesso(
    'Listagem padrao apos a remocao',
    api('GET', `/monitorias/${monitoria.id}/materiais`, { token: monitorado.token }),
  );

  const listaComRemovidos = await esperarSucesso(
    'Listagem com incluirRemovidos=true',
    api('GET', `/monitorias/${monitoria.id}/materiais?incluirRemovidos=true`, {
      token: professor.token,
    }),
  );

  // RN10: remover e esconder da listagem, nao apagar do banco.
  if (listaPadrao.meta.total === 1 && listaComRemovidos.meta.total === 2) {
    ok('RN10: removido sai da listagem mas continua no banco', '1 visivel, 2 no total');
  } else {
    falhou(
      'Soft delete nao se comportou como esperado',
      `padrao=${listaPadrao.meta.total} comRemovidos=${listaComRemovidos.meta.total}`,
    );
  }

  await esperarRecusa(
    'Remover duas vezes e recusado (409)',
    409,
    api('POST', `/monitorias/${monitoria.id}/materiais/${materialDoProfessor.id}/remover`, {
      token: professor.token,
    }),
  );

  secao('9. Encerramento preserva o historico');
  const pendente = await esperarSucesso(
    'Ana abre mais uma sessao, que fica AGENDADA',
    api('POST', `/monitorias/${monitoria.id}/atendimentos`, {
      token: monitora.token,
      corpo: {
        inicio: new Date(horario.inicio.getTime() + 14 * 24 * 3600_000).toISOString(),
        fim: new Date(horario.fim.getTime() + 14 * 24 * 3600_000).toISOString(),
        assunto: 'Revisao para a prova',
        modalidade: 'PRESENCIAL',
        local: 'Sala 203',
      },
    }),
  );

  /**
   * Bruno se inscreve ANTES do reagendamento de proposito.
   *
   * Reagendar sem inscritos nao avisa ninguem — e nao deveria mesmo. O caso que
   * importa e este: a inscricao e preservada (B5), entao a pessoa continua
   * marcada em um horario que ela nao escolheu e precisa ser avisada.
   */
  await esperarSucesso(
    'Bruno se inscreve na sessao que sera reagendada',
    api('POST', `/atendimentos/${pendente.id}/inscricao`, { token: monitorado.token }),
  );

  await esperarRecusa(
    'Nao encerra monitoria com atendimento AGENDADO pendente (409)',
    409,
    api('POST', `/monitorias/${monitoria.id}/encerrar`, { token: professor.token }),
  );

  const reagendado = await esperarSucesso(
    'Ana reagenda o atendimento sem cancelar (B5)',
    api('POST', `/atendimentos/${pendente.id}/reagendar`, {
      token: monitora.token,
      corpo: {
        inicio: new Date(horario.inicio.getTime() + 21 * 24 * 3600_000).toISOString(),
        fim: new Date(horario.fim.getTime() + 21 * 24 * 3600_000).toISOString(),
        motivo: 'Conflito com a semana de provas.',
      },
    }),
  );

  if (reagendado.status === 'AGENDADO') {
    ok('Continua AGENDADO — reagendar nao e cancelar');
  } else {
    falhou('Status inesperado apos reagendar', reagendado.status);
  }

  const historicoReagendado = await esperarSucesso(
    'Historico do atendimento reagendado',
    api('GET', `/atendimentos/${pendente.id}/historico`, { token: monitora.token }),
  );

  if (historicoReagendado.some((h) => h.motivo?.includes('Reagendado. Antes:'))) {
    ok('RN10: o horario anterior ficou registrado no historico');
  } else {
    falhou('Reagendamento nao deixou rastro no historico');
  }

  await esperarRecusa(
    'Reagendar para fora da disponibilidade e recusado (409)',
    409,
    api('POST', `/atendimentos/${pendente.id}/reagendar`, {
      token: monitora.token,
      corpo: {
        inicio: new Date(
          horario.inicio.getTime() + 21 * 24 * 3600_000 + 6 * 3600_000,
        ).toISOString(),
        fim: new Date(horario.fim.getTime() + 21 * 24 * 3600_000 + 6 * 3600_000).toISOString(),
        motivo: 'Horario fora da janela declarada.',
      },
    }),
  );

  await esperarSucesso(
    'Professor cancela o atendimento pendente',
    api('POST', `/atendimentos/${pendente.id}/cancelar`, {
      token: professor.token,
      corpo: { motivo: 'Fim do semestre letivo.' },
    }),
  );

  const encerrada = await esperarSucesso(
    'Professor encerra a monitoria',
    api('POST', `/monitorias/${monitoria.id}/encerrar`, { token: professor.token }),
  );

  if (encerrada.status === 'ENCERRADA') {
    ok('Monitoria ENCERRADA');
  } else {
    falhou('Status inesperado', encerrada.status);
  }

  const historicoParticipantes = await esperarSucesso(
    'RN10: participantes encerrados continuam consultaveis',
    api('GET', `/monitorias/${monitoria.id}/participantes?status=ENCERRADO`, {
      token: professor.token,
    }),
  );

  if (historicoParticipantes.dados.length === 2) {
    ok('Os 2 vinculos foram encerrados sem serem apagados');
  } else {
    falhou(`Esperava 2 vinculos encerrados, veio ${historicoParticipantes.dados.length}`);
  }

  await verificarRecuperacaoDeSenha(monitorado);
  await verificarNotificacoes({ monitora, monitorado, monitoria });
  await verificarLogs({ professor, monitorado });

  console.log(
    `\n${falhas === 0 ? verde('TODOS OS PASSOS PASSARAM') : vermelho(`${falhas} FALHA(S)`)}` +
      cinza(` — ${passos} verificacoes\n`),
  );

  process.exit(falhas === 0 ? 0 : 1);
}

/**
 * Recuperacao de senha ponta a ponta.
 *
 * Nenhuma etapa aqui faz login, e isso e proposital: /auth/login aceita 5
 * tentativas por minuto e o fluxo ja gasta quatro. A prova de que a senha
 * mudou e feita contra o banco, com argon2.verify sobre o hash armazenado —
 * mais direta que um login, e sem consumir a cota.
 *
 * O codigo nunca trafega pela API: ele e enviado por e-mail e guardado como
 * hash. Para exercitar o caminho feliz, o script SUBSTITUI o hash no banco por
 * um de codigo conhecido — mesmo tipo de artificio ja usado em viajarNoTempo.
 * Isso nao enfraquece o teste: o que se verifica depois e exatamente o que a
 * aplicacao faz com um codigo correto.
 */
async function verificarRecuperacaoDeSenha(usuario) {
  secao('10. Recuperacao de senha por codigo');

  const SENHA_REDEFINIDA = 'senhaRedefinida789';
  const CODIGO = '135790';

  await esperarSucesso(
    'Solicitar recuperacao para e-mail INEXISTENTE devolve 202',
    api('POST', '/auth/recuperacao/solicitar', {
      corpo: { email: `nao.existe.${SUFIXO}@ufx.edu.br` },
    }),
  );

  await esperarSucesso(
    'Solicitar recuperacao para e-mail existente devolve 202 — resposta identica',
    api('POST', '/auth/recuperacao/solicitar', { corpo: { email: usuario.email } }),
  );

  const { status, dados } = await api('POST', '/auth/recuperacao/confirmar', {
    corpo: { email: usuario.email, codigo: '000000', novaSenha: SENHA_REDEFINIDA },
  });

  if (status === 400 && /invalido ou expirado/i.test(dados?.mensagem ?? '')) {
    ok('Codigo errado e recusado com mensagem generica', dados.mensagem);
  } else {
    falhou('Codigo errado deveria dar 400 generico', `HTTP ${status} ${JSON.stringify(dados)}`);
  }

  const cliente = await conectarAoBanco();

  try {
    const { rows: antes } = await cliente.query(
      `SELECT id, tentativas FROM recuperacoes_senha
        WHERE usuario_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL`,
      [usuario.id],
    );

    if (antes.length === 1 && antes[0].tentativas === 1) {
      ok('A tentativa errada foi contabilizada', 'tentativas=1');
    } else {
      falhou('Contador de tentativas nao bateu', JSON.stringify(antes));
    }

    // Artificio: troca o hash por um de codigo conhecido, como se fosse o que
    // chegou por e-mail.
    await cliente.query('UPDATE recuperacoes_senha SET codigo_hash = $1 WHERE id = $2', [
      await argon2.hash(CODIGO, OPCOES_ARGON2),
      antes[0].id,
    ]);

    await esperarSucesso(
      'Codigo correto redefine a senha (204)',
      api('POST', '/auth/recuperacao/confirmar', {
        corpo: { email: usuario.email, codigo: CODIGO, novaSenha: SENHA_REDEFINIDA },
      }),
    );

    const { rows: depois } = await cliente.query(
      `SELECT u.senha_hash, r.usado_em
         FROM usuarios u
         JOIN recuperacoes_senha r ON r.usuario_id = u.id
        WHERE r.id = $1`,
      [antes[0].id],
    );

    if (depois[0].usado_em) {
      ok('Codigo marcado como usado — nao foi apagado (RN10)');
    } else {
      falhou('Codigo nao foi marcado como usado');
    }

    if (await argon2.verify(depois[0].senha_hash, SENHA_REDEFINIDA)) {
      ok('A senha no banco e a nova, e continua armazenada como hash argon2id');
    } else {
      falhou('A senha nao foi trocada');
    }

    await esperarRecusa(
      'Uso unico: o mesmo codigo nao funciona de novo (400)',
      400,
      api('POST', '/auth/recuperacao/confirmar', {
        corpo: { email: usuario.email, codigo: CODIGO, novaSenha: 'outraSenha123' },
      }),
    );
  } finally {
    await cliente.end();
  }
}

/**
 * Notificacoes por e-mail.
 *
 * Verifica o REGISTRO, nao a caixa de entrada: o que da para afirmar aqui e que
 * a linha certa nasceu, para a pessoa certa, com a referencia certa. Se o
 * servidor estiver com e-mail configurado, a mensagem tambem sai de verdade —
 * motivo pelo qual este fluxo deve rodar com BREVO_API_KEY vazio.
 *
 * Exige NOTIFICACOES_HABILITADAS=true no servidor. Sem isso a secao e pulada em
 * vez de falhar: desabilitado e o padrao do projeto, nao um defeito.
 */
async function verificarNotificacoes({ monitora, monitorado, monitoria }) {
  secao('11. Notificacoes por e-mail');

  const cliente = await conectarAoBanco();

  try {
    const { rows: ligado } = await cliente.query(
      `SELECT count(*)::int AS n FROM notificacoes WHERE created_at > now() - interval '10 minutes'`,
    );

    const { rows: deste } = await cliente.query(
      `SELECT n.tipo, n.usuario_id, n.referencia_id, n.assunto, n.enviado_em, n.tentativas
         FROM notificacoes n
        WHERE n.usuario_id IN ($1, $2)
        ORDER BY n.created_at`,
      [monitora.id, monitorado.id],
    );

    if (deste.length === 0 && ligado[0].n === 0) {
      console.log(
        cinza(
          '  (pulada) Nenhuma notificacao registrada. Suba o servidor com ' +
            'NOTIFICACOES_HABILITADAS=true para exercitar esta secao.',
        ),
      );
      return;
    }

    const tipos = deste.map((linha) => linha.tipo);

    /**
     * MONITOR_HABILITADO: a Ana foi habilitada como monitora na secao 3, por
     * ato do professor — ela precisa saber que passou a ter deveres (RN01).
     */
    const habilitacao = deste.find(
      (l) => l.tipo === 'MONITOR_HABILITADO' && l.usuario_id === monitora.id,
    );

    if (habilitacao) {
      ok('MONITOR_HABILITADO gerado para a monitora', habilitacao.assunto);
    } else {
      falhou('Nenhum MONITOR_HABILITADO para a monitora', tipos.join(', '));
    }

    /** ATENDIMENTO_CANCELADO e ATENDIMENTO_REAGENDADO vieram da secao 9. */
    for (const tipo of ['ATENDIMENTO_REAGENDADO', 'ATENDIMENTO_CANCELADO']) {
      if (tipos.includes(tipo)) {
        ok(`${tipo} gerado`);
      } else {
        falhou(`${tipo} ausente`, `tipos vistos: ${tipos.join(', ') || 'nenhum'}`);
      }
    }

    /**
     * Verificar o DESTINATARIO, nao so o tipo.
     *
     * A versao anterior desta secao afirmava apenas que a linha existia, e
     * passava com o aviso indo so para o monitor — o inscrito, que e quem ia se
     * deslocar, nunca era avisado. Cancelar um atendimento cancela as
     * inscricoes antes de o evento ser emitido, entao a lista de inscritos
     * precisa viajar no proprio evento.
     */
    const cancelamentoParaInscrito = deste.find(
      (l) => l.tipo === 'ATENDIMENTO_CANCELADO' && l.usuario_id === monitorado.id,
    );

    if (cancelamentoParaInscrito) {
      ok('Quem estava INSCRITO foi avisado do cancelamento', cancelamentoParaInscrito.assunto);
    } else {
      falhou(
        'O inscrito NAO foi avisado do cancelamento',
        'a inscricao e cancelada junto com o atendimento; a lista precisa vir no evento',
      );
    }

    const reagendamentoParaInscrito = deste.find(
      (l) => l.tipo === 'ATENDIMENTO_REAGENDADO' && l.usuario_id === monitorado.id,
    );

    if (reagendamentoParaInscrito) {
      ok('Quem estava inscrito foi avisado do novo horario');
    } else {
      falhou('O inscrito NAO foi avisado do reagendamento');
    }

    /**
     * AVALIACAO_PENDENTE sai do evento que a gamificacao ja consumia: nenhuma
     * emissao nova foi precisa no nucleo para este tipo.
     */
    if (tipos.includes('AVALIACAO_PENDENTE')) {
      ok('AVALIACAO_PENDENTE gerado a partir do evento de atendimento realizado');
    } else {
      falhou('AVALIACAO_PENDENTE ausente', tipos.join(', '));
    }

    /**
     * A verificacao que mais importa: a UNIQUE (tipo, referencia_id,
     * usuario_id). Sem ela, cada reinicio da aplicacao reenviaria tudo.
     */
    const { rows: duplicadas } = await cliente.query(
      `SELECT tipo, referencia_id, usuario_id, count(*) AS n
         FROM notificacoes
        GROUP BY tipo, referencia_id, usuario_id
       HAVING count(*) > 1`,
    );

    if (duplicadas.length === 0) {
      ok('Nenhuma notificacao duplicada', `${deste.length} linhas para os dois alunos`);
    } else {
      falhou('Ha notificacoes duplicadas', JSON.stringify(duplicadas));
    }

    /**
     * Reagendamento aconteceu UMA vez neste fluxo, mas a chave e a linha de
     * historico: se fosse o id do atendimento, um segundo reagendamento seria
     * descartado como duplicata. Confirma-se que a referencia aponta mesmo para
     * o historico, e nao para o atendimento.
     */
    const reagendamento = deste.find((l) => l.tipo === 'ATENDIMENTO_REAGENDADO');

    if (reagendamento) {
      const { rows: ehHistorico } = await cliente.query(
        'SELECT 1 FROM atendimento_status_historico WHERE id = $1',
        [reagendamento.referencia_id],
      );

      if (ehHistorico.length === 1) {
        ok('A referencia do aviso de transicao e a linha de historico, nao o atendimento');
      } else {
        falhou('referencia_id nao aponta para o historico', reagendamento.referencia_id);
      }
    }

    /** Com e-mail em modo log, enviar() devolve false: a linha fica pendente. */
    const pendentes = deste.filter((l) => !l.enviado_em).length;
    const entregues = deste.length - pendentes;

    ok(
      'Estado de entrega registrado por linha',
      `${entregues} entregue(s), ${pendentes} pendente(s) para reenvio`,
    );

    const { rows: naoEnvolvidos } = await cliente.query(
      `SELECT count(*)::int AS n
         FROM notificacoes n
        WHERE n.referencia_id IN (
                SELECT id FROM atendimentos WHERE monitoria_id = $1
              )
          AND n.usuario_id NOT IN ($2, $3)`,
      [monitoria.id, monitora.id, monitorado.id],
    );

    if (naoEnvolvidos[0].n === 0) {
      ok('Ninguem de fora da monitoria foi notificado');
    } else {
      falhou('Notificacao enviada a quem nao participa', `${naoEnvolvidos[0].n} linhas`);
    }
  } finally {
    await cliente.end();
  }
}

/**
 * Trilha de requisicoes.
 *
 * O risco deste modulo nao e deixar de registrar: e registrar demais. Por isso
 * a verificacao central aqui e NEGATIVA — nenhuma senha pode aparecer na
 * tabela, embora o fluxo inteiro tenha acabado de autenticar quatro contas.
 */
async function verificarLogs({ professor, monitorado }) {
  secao('12. Trilha de requisicoes');

  const cliente = await conectarAoBanco();

  try {
    const { rows: recentes } = await cliente.query(
      `SELECT count(*)::int AS n FROM logs_requisicao WHERE criado_em > now() - interval '10 minutes'`,
    );

    if (recentes[0].n === 0) {
      console.log(
        cinza(
          '  (pulada) Nenhum log recente. Suba o servidor com LOGS_REQUISICAO_HABILITADOS=true.',
        ),
      );
      return;
    }

    ok('Requisicoes registradas', `${recentes[0].n} nos ultimos 10 minutos`);

    /**
     * A verificacao que mais importa. O fluxo autenticou quatro contas com esta
     * senha; se ela aparecer em qualquer coluna, a redacao falhou.
     */
    const { rows: vazou } = await cliente.query(
      `SELECT count(*)::int AS n
         FROM logs_requisicao
        WHERE corpo LIKE '%' || $1 || '%'
           OR resposta LIKE '%' || $1 || '%'
           OR query LIKE '%' || $1 || '%'`,
      [SENHA],
    );

    if (vazou[0].n === 0) {
      ok('Nenhuma senha em texto claro na tabela de logs');
    } else {
      falhou('SENHA VAZOU para o log', `${vazou[0].n} linhas`);
    }

    const { rows: redigidos } = await cliente.query(
      `SELECT count(*)::int AS n FROM logs_requisicao WHERE corpo LIKE '%[REDACTED]%'`,
    );

    if (redigidos[0].n > 0) {
      ok('Campos sensiveis marcados como redigidos', `${redigidos[0].n} linhas`);
    } else {
      falhou('Nenhuma marca de redacao — a redacao pode nao estar rodando');
    }

    /**
     * 401 e 403 nascem em GUARDS, que impedem o interceptor de rodar. Se
     * aparecerem aqui, e porque o filtro de excecoes tambem registra — que e a
     * divisao de trabalho que cobre a trilha inteira.
     */
    const { rows: recusas } = await cliente.query(
      `SELECT status_http, count(*)::int AS n
         FROM logs_requisicao
        WHERE status_http IN (401, 403)
          AND criado_em > now() - interval '10 minutes'
        GROUP BY status_http ORDER BY status_http`,
    );

    if (recusas.length > 0) {
      ok(
        'Recusas de guard registradas (o interceptor sozinho nao as veria)',
        recusas.map((r) => `${r.status_http}:${r.n}`).join(' '),
      );
    } else {
      falhou('Nenhum 401/403 registrado', 'o fluxo gerou varios');
    }

    const { rows: autenticadas } = await cliente.query(
      `SELECT count(*)::int AS n
         FROM logs_requisicao
        WHERE usuario_id = ANY($1) AND criado_em > now() - interval '10 minutes'`,
      [[professor.id, monitorado.id]],
    );

    if (autenticadas[0].n > 0) {
      ok('Usuario autenticado identificado no log', `${autenticadas[0].n} requisicoes`);
    } else {
      falhou('Nenhuma requisicao associada aos usuarios do fluxo');
    }

    const { rows: agregado } = await cliente.query(
      `SELECT count(DISTINCT rota)::int AS rotas, count(DISTINCT caminho)::int AS caminhos
         FROM logs_requisicao
        WHERE criado_em > now() - interval '10 minutes' AND rota IS NOT NULL`,
    );

    if (agregado[0].rotas < agregado[0].caminhos) {
      ok(
        'A coluna `rota` agrega caminhos com id distintos',
        `${agregado[0].rotas} rotas para ${agregado[0].caminhos} caminhos`,
      );
    } else {
      ok('Rotas registradas', `${agregado[0].rotas}`);
    }
  } finally {
    await cliente.end();
  }
}

main().catch((erro) => {
  console.error(`\n${vermelho('ERRO FATAL')} ${erro.message}\n`);
  process.exit(1);
});
