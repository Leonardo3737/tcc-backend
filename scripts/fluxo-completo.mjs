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

  /**
   * Guardada porque a aprovacao de candidatura precisa de um professor que NAO
   * seja quem aprova: o responsavel pela monitoria criada e o INDICADO na
   * inscricao, e com os dois sendo a mesma pessoa a verificacao nao provaria
   * nada.
   */
  const profMaria = await esperarSucesso(
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

  /**
   * Aluno e disciplina passaram a pertencer a um CURSO, e so se encontram
   * dentro dele. O fluxo cria o seu, para nao depender de dado preexistente.
   */
  const curso = await esperarSucesso(
    'Professor cadastra o curso',
    api('POST', '/cursos', {
      token: professor.token,
      corpo: { nome: `Ciencia da Computacao ${SUFIXO.slice(-4)}` },
    }),
  );

  if (/^CIE\d{3,}$/.test(curso.codigo)) {
    ok('Codigo do curso gerado a partir do nome', curso.codigo);
  } else {
    falhou('Codigo do curso fora do formato', curso.codigo);
  }

  const cursoVizinho = await esperarSucesso(
    'Professor cadastra um segundo curso',
    api('POST', '/cursos', {
      token: professor.token,
      corpo: { nome: `Medicina ${SUFIXO.slice(-4)}` },
    }),
  );

  await esperarRecusa(
    'Professor NAO pode escolher o codigo do curso (400)',
    400,
    api('POST', '/cursos', {
      token: professor.token,
      corpo: { nome: 'Codigo Escolhido', codigo: `MEU${SUFIXO.slice(-4)}` },
    }),
  );

  const monitora = await criarELogar('aluno', 'Ana Monitora', professor.token, {
    matricula: `M${SUFIXO}`,
    cursoId: curso.id,
  });
  const monitorado = await criarELogar('aluno', 'Bruno Aluno', professor.token, {
    matricula: `A${SUFIXO}`,
    cursoId: curso.id,
  });
  const estranho = await criarELogar('aluno', 'Carla Externa', professor.token, {
    matricula: `X${SUFIXO}`,
    cursoId: curso.id,
  });

  /** Aluno de OUTRO curso, para provar que a regra barra a participacao. */
  const deOutroCurso = await esperarSucesso(
    'Professor cadastra aluno de outro curso',
    api('POST', '/alunos', {
      token: professor.token,
      corpo: {
        nome: 'Diego Medicina',
        email: `diego.medicina.${SUFIXO}@ufx.edu.br`,
        matricula: `D${SUFIXO}`,
        cursoId: cursoVizinho.id,
      },
    }),
  );

  if (deOutroCurso.aluno.cursoId === cursoVizinho.id) {
    ok('Aluno vinculado ao curso informado', deOutroCurso.aluno.curso);
  } else {
    falhou('cursoId do aluno nao bateu');
  }

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
    api('POST', '/disciplinas', {
      token: professor.token,
      corpo: { nome: 'Calculo I', cursosIds: [curso.id] },
    }),
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
    api('POST', '/disciplinas', {
      token: professor.token,
      corpo: { nome: 'Calculo I', cursosIds: [curso.id] },
    }),
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
      corpo: {
        codigo: `MEU${SUFIXO.slice(-4)}`,
        nome: 'Codigo Escolhido',
        cursosIds: [curso.id],
      },
    }),
  );

  await esperarRecusa(
    'RN: aluno NAO pode cadastrar disciplina (403)',
    403,
    api('POST', '/disciplinas', {
      token: monitorado.token,
      corpo: { nome: 'Invalida', cursosIds: [curso.id] },
    }),
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

  /**
   * Edicao de dados basicos. Monitoria e disciplina ja tinham PATCH; o do
   * atendimento aparece na secao 5, depois que existe um para editar.
   */
  await esperarSucesso(
    'Professor edita dados basicos da monitoria',
    api('PATCH', `/monitorias/${monitoria.id}`, {
      token: professor.token,
      corpo: { descricao: 'Foco em exercicios de prova.' },
    }),
  );

  const disciplinaEditada = await esperarSucesso(
    'Professor renomeia a disciplina',
    api('PATCH', `/disciplinas/${disciplina.id}`, {
      token: professor.token,
      corpo: { nome: 'Calculo Diferencial e Integral I' },
    }),
  );

  if (disciplinaEditada.codigo === disciplina.codigo) {
    ok('Renomear nao muda o codigo gerado', disciplinaEditada.codigo);
  } else {
    falhou('O codigo mudou ao renomear', `${disciplina.codigo} -> ${disciplinaEditada.codigo}`);
  }

  await esperarRecusa(
    'RN: aluno NAO pode editar a monitoria (403)',
    403,
    api('PATCH', `/monitorias/${monitoria.id}`, {
      token: monitorado.token,
      corpo: { descricao: 'Invasao' },
    }),
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

  /**
   * A regra nova: a disciplina pertence a um curso, e so alunos dele podem
   * participar. Vale para os DOIS papeis — monitorar pressupoe ter cursado a
   * disciplina no mesmo curso.
   */
  /**
   * Uma disciplina pode servir VARIOS cursos: "Banco de Dados" e de Sistemas de
   * Informacao e de Engenharia da Computacao. Uma monitoria so atende os dois.
   */
  const compartilhada = await esperarSucesso(
    'Disciplina em DOIS cursos',
    api('POST', '/disciplinas', {
      token: professor.token,
      corpo: {
        nome: `Banco de Dados ${SUFIXO.slice(-4)}`,
        cursosIds: [curso.id, cursoVizinho.id],
      },
    }),
  );

  if (compartilhada.cursos?.length === 2) {
    ok('Disciplina aceita mais de um curso', compartilhada.cursos.map((c) => c.codigo).join(' + '));
  } else {
    falhou('Nao gravou os dois cursos', JSON.stringify(compartilhada.cursos));
  }

  await esperarRecusa(
    'Disciplina sem nenhum curso e recusada (400)',
    400,
    api('POST', '/disciplinas', {
      token: professor.token,
      corpo: { nome: 'Sem curso nenhum', cursosIds: [] },
    }),
  );

  const porCurso = await esperarSucesso(
    'Filtro de disciplinas por curso',
    api('GET', `/disciplinas?cursoId=${cursoVizinho.id}`, { token: professor.token }),
  );

  const achou = porCurso.dados.find((d) => d.id === compartilhada.id);

  if (achou) {
    ok('A compartilhada aparece no filtro do segundo curso');
  } else {
    falhou('Filtro por curso nao encontrou a disciplina compartilhada');
  }

  /**
   * O ponto fino do filtro: ele restringe QUAIS disciplinas aparecem, nao o
   * conteudo de cada uma. Se viesse so o curso filtrado, a resposta afirmaria
   * que a disciplina pertence a um curso so.
   */
  if (achou && achou.cursos.length === 2) {
    ok('Filtrar por um curso nao esconde os outros cursos da disciplina');
  } else {
    falhou('O filtro truncou a lista de cursos', JSON.stringify(achou?.cursos));
  }

  if (!porCurso.dados.some((d) => d.id === disciplina.id)) {
    ok('Disciplina de outro curso fica de fora do filtro');
  } else {
    falhou('Filtro trouxe disciplina de curso nao pedido');
  }

  const alunosDoCurso = await esperarSucesso(
    'Filtro de alunos por curso',
    api('GET', `/alunos?cursoId=${cursoVizinho.id}`, { token: professor.token }),
  );

  const soDoCurso = alunosDoCurso.dados.every((a) => a.aluno.cursoId === cursoVizinho.id);

  if (soDoCurso && alunosDoCurso.dados.some((a) => a.id === deOutroCurso.id)) {
    ok('Lista traz apenas alunos do curso pedido', `${alunosDoCurso.meta.total} aluno(s)`);
  } else {
    falhou('Filtro de alunos por curso incorreto');
  }

  await esperarRecusa(
    'REGRA DE CURSO: aluno de outro curso nao e inscrito como MONITORADO (409)',
    409,
    api('POST', `/monitorias/${monitoria.id}/monitorados`, {
      token: professor.token,
      corpo: { alunoId: deOutroCurso.id },
    }),
  );

  await esperarRecusa(
    'REGRA DE CURSO: aluno de outro curso nao e habilitado como MONITOR (409)',
    409,
    api('POST', `/monitorias/${monitoria.id}/monitores`, {
      token: professor.token,
      corpo: { alunoId: deOutroCurso.id },
    }),
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

  const editado = await esperarSucesso(
    'Monitor edita dados basicos do atendimento',
    api('PATCH', `/atendimentos/${atendimento.id}`, {
      token: monitora.token,
      corpo: { assunto: 'Limites e continuidade', local: 'Sala 203', vagas: 4 },
    }),
  );

  if (
    editado.assunto === 'Limites e continuidade' &&
    editado.local === 'Sala 203' &&
    editado.vagas === 4
  ) {
    ok('Assunto, local e vagas atualizados');
  } else {
    falhou('Edicao nao refletiu na resposta', JSON.stringify(editado));
  }

  const horarioPreservado =
    new Date(editado.inicio).getTime() === horario.inicio.getTime() &&
    editado.status === 'AGENDADO';

  if (horarioPreservado) {
    ok('Editar nao mexe em horario nem status — isso e /reagendar e /cancelar');
  } else {
    falhou('A edicao alterou horario ou status', JSON.stringify(editado));
  }

  await esperarRecusa(
    'Editar NAO aceita horario: campo desconhecido e recusado (400)',
    400,
    api('PATCH', `/atendimentos/${atendimento.id}`, {
      token: monitora.token,
      corpo: { inicio: new Date(horario.inicio.getTime() + 3600_000).toISOString() },
    }),
  );

  /**
   * O atendimento tem 1 inscrito (o proprio solicitante), entao `vagas: 1` e o
   * limite exato do permitido — reduzir mais deixaria mais gente dentro do que
   * capacidade.
   *
   * A RECUSA (vagas < inscritos) nao e verificavel aqui: exigiria dois
   * inscritos no mesmo atendimento, o que este fluxo nao produz. Fica coberta
   * no teste de unidade, onde a contagem e controlavel.
   */
  await esperarSucesso(
    'Vagas iguais ao numero de inscritos e aceito (limite exato)',
    api('PATCH', `/atendimentos/${atendimento.id}`, {
      token: monitora.token,
      corpo: { vagas: 1 },
    }),
  );

  await esperarRecusa(
    'RN: aluno de fora NAO pode editar o atendimento (403)',
    403,
    api('PATCH', `/atendimentos/${atendimento.id}`, {
      token: estranho.token,
      corpo: { assunto: 'Invasao' },
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
  await verificarAjustesDeApi({ professor, monitora, monitorado, monitoria, vinculoMonitora });
  await verificarEditais({
    professor,
    profMaria,
    monitorado,
    curso,
    cursoVizinho,
    disciplina,
    compartilhada,
  });

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

/**
 * Ajustes de usabilidade (A1-A4, B1-B2).
 *
 * Roda no fim, com a monitoria ja encerrada, entao o que se verifica aqui sao
 * as rotas de LEITURA e as recusas. A criacao em lote e a promocao exigem
 * monitoria ATIVA e tem cobertura de unidade.
 */
async function verificarAjustesDeApi({ professor, monitora, monitorado, monitoria }) {
  secao('13. Ajustes de usabilidade (A1-A4, B1-B2)');

  const configuracao = await esperarSucesso(
    'B1: GET /configuracao traz a duracao padrao',
    api('GET', '/configuracao'),
  );

  const limites = configuracao.agendamento;

  if (
    typeof limites.duracaoPadraoMinutos === 'number' &&
    limites.duracaoPadraoMinutos >= limites.duracaoMinimaMinutos &&
    limites.duracaoPadraoMinutos <= limites.duracaoMaximaMinutos
  ) {
    ok('B1: duracao padrao coerente com minimo e maximo', `${limites.duracaoPadraoMinutos} min`);
  } else {
    falhou('B1: duracao padrao fora da faixa', JSON.stringify(limites));
  }

  const regras = await esperarSucesso(
    'B2: GET /gamificacao/regras',
    api('GET', '/gamificacao/regras', { token: monitorado.token }),
  );

  const avaliacao = regras.regras.find((r) => r.tipo === 'AVALIACAO_RECEBIDA');

  if (avaliacao && avaliacao.pontos === null) {
    ok('B2: AVALIACAO_RECEBIDA vem com pontos null (valor variavel)');
  } else {
    falhou('B2: AVALIACAO_RECEBIDA deveria vir null', JSON.stringify(avaliacao));
  }

  if (regras.regras.every((r) => r.descricao?.length > 0)) {
    ok('B2: toda regra tem descricao', `${regras.regras.length} regras`);
  } else {
    falhou('B2: ha regra sem descricao');
  }

  const de = new Date().toISOString();
  const ate = new Date(Date.now() + 14 * 864e5).toISOString();

  const livres = await esperarSucesso(
    'A1: GET horarios-livres',
    api('GET', `/monitorias/${monitoria.id}/atendimentos/horarios-livres?de=${de}&ate=${ate}`, {
      token: monitorado.token,
    }),
  );

  if (Array.isArray(livres.horarios) && typeof livres.truncado === 'boolean') {
    ok('A1: resposta no formato esperado', `${livres.horarios.length} slot(s)`);
  } else {
    falhou('A1: formato inesperado', JSON.stringify(livres).slice(0, 120));
  }

  await esperarRecusa(
    'A1: janela maior que 60 dias e recusada (400)',
    400,
    api(
      'GET',
      `/monitorias/${monitoria.id}/atendimentos/horarios-livres?de=${de}` +
        `&ate=${new Date(Date.now() + 61 * 864e5).toISOString()}`,
      { token: monitorado.token },
    ),
  );

  await esperarRecusa(
    'A1: duracao fora dos limites e recusada (400)',
    400,
    api(
      'GET',
      `/monitorias/${monitoria.id}/atendimentos/horarios-livres?de=${de}&ate=${ate}` +
        '&duracaoMinutos=5',
      { token: monitorado.token },
    ),
  );

  /** A4 — os filtros de agenda pessoal nao valem na listagem da monitoria. */
  for (const filtro of ['aguardandoRegistro', 'pendentesDeAvaliacao']) {
    await esperarRecusa(
      `A4: ${filtro} em /monitorias/:id/atendimentos e recusado (400)`,
      400,
      api('GET', `/monitorias/${monitoria.id}/atendimentos?${filtro}=true`, {
        token: professor.token,
      }),
    );
  }

  await esperarRecusa(
    'A4: os dois filtros juntos sao recusados (400)',
    400,
    api('GET', '/atendimentos/meus?aguardandoRegistro=true&pendentesDeAvaliacao=true', {
      token: monitorado.token,
    }),
  );

  const aguardando = await esperarSucesso(
    'A4: aguardandoRegistro em /atendimentos/meus',
    api('GET', '/atendimentos/meus?aguardandoRegistro=true', { token: monitora.token }),
  );

  const soAgendados = aguardando.dados.every(
    (a) => a.status === 'AGENDADO' && new Date(a.inicio) < new Date(),
  );

  if (soAgendados) {
    ok('A4: fila traz apenas AGENDADOS ja iniciados', `${aguardando.dados.length} sessao(oes)`);
  } else {
    falhou('A4: a fila trouxe sessao fora do recorte');
  }

  const pendentes = await esperarSucesso(
    'A4: pendentesDeAvaliacao em /atendimentos/meus',
    api('GET', '/atendimentos/meus?pendentesDeAvaliacao=true', { token: monitorado.token }),
  );

  if (pendentes.dados.every((a) => a.status === 'REALIZADO')) {
    ok('A4: so REALIZADOS aparecem como pendentes de avaliacao', `${pendentes.dados.length}`);
  } else {
    falhou('A4: trouxe atendimento nao REALIZADO');
  }
}

/**
 * Editais de selecao de monitores — fase 4.
 *
 * E a primeira parte do sistema com escrita PUBLICA, e por isso a secao gasta
 * mais linhas em recusas do que em caminho feliz: o que precisa ser provado nao
 * e que a inscricao funciona, e que ela nao abre porta para nada alem dela
 * mesma. Em particular: nao cria conta, nao aceita media do cliente, nao
 * expoe dado de candidato sem token e nao aceita arquivo que nao seja PDF.
 *
 * O teto de requisicoes da rota publica e de 20/min por IP, e esta secao gasta
 * cerca de 15. Rodar o fluxo duas vezes no mesmo minuto estoura o limite e as
 * falhas aparecem como 429 — nao e regressao.
 */
async function verificarEditais({
  professor,
  profMaria,
  monitorado,
  curso,
  cursoVizinho,
  disciplina,
  compartilhada,
}) {
  secao('14. Editais e inscricoes de candidatos');

  const hoje = await dataLocalDaInstituicao();
  const ontem = somarDias(hoje, -1);
  const amanha = somarDias(hoje, 1);
  const daquiUmMes = somarDias(hoje, 30);

  /** ------------------------------------------------- gestao pelo professor */

  const edital = await esperarSucesso(
    'Professor cria o edital',
    api('POST', '/editais', {
      token: professor.token,
      corpo: {
        inicioInscricoes: ontem,
        fimInscricoes: daquiUmMes,
        link: 'https://ufx.edu.br/editais/monitoria-2026-2.pdf',
        ano: 2026,
        semestre: 2,
      },
    }),
  );

  if (edital.aceitandoInscricoes === true && edital.ativo === true) {
    ok('Edital nasce ativo e aceitando inscricoes', `${edital.inicioInscricoes} a ${edital.fimInscricoes}`);
  } else {
    falhou('Edital criado em estado inesperado', JSON.stringify(edital));
  }

  const editalFuturo = await esperarSucesso(
    'Professor cria um edital que ainda nao abriu',
    api('POST', '/editais', {
      token: professor.token,
      corpo: {
        inicioInscricoes: amanha,
        fimInscricoes: daquiUmMes,
        link: 'https://ufx.edu.br/editais/monitoria-2027-1.pdf',
        ano: 2027,
        semestre: 1,
      },
    }),
  );

  if (editalFuturo.aceitandoInscricoes === false) {
    ok('Edital fora do periodo nao aceita inscricoes', editalFuturo.inicioInscricoes);
  } else {
    falhou('Edital futuro marcado como aberto');
  }

  await esperarRecusa(
    'Periodo invertido e recusado (409)',
    409,
    api('POST', '/editais', {
      token: professor.token,
      corpo: {
        inicioInscricoes: daquiUmMes,
        fimInscricoes: ontem,
        link: 'https://ufx.edu.br/editais/invalido.pdf',
        ano: 2026,
        semestre: 1,
      },
    }),
  );

  await esperarRecusa(
    'Link sem protocolo e recusado (400)',
    400,
    api('POST', '/editais', {
      token: professor.token,
      corpo: {
        inicioInscricoes: ontem,
        fimInscricoes: daquiUmMes,
        link: 'ufx.edu.br/edital.pdf',
        ano: 2026,
        semestre: 1,
      },
    }),
  );

  await esperarRecusa(
    'Semestre 3 e recusado (400)',
    400,
    api('POST', '/editais', {
      token: professor.token,
      corpo: {
        inicioInscricoes: ontem,
        fimInscricoes: daquiUmMes,
        link: 'https://ufx.edu.br/e.pdf',
        ano: 2026,
        semestre: 3,
      },
    }),
  );

  await esperarRecusa(
    'ALUNO nao pode criar edital (403)',
    403,
    api('POST', '/editais', {
      token: monitorado.token,
      corpo: {
        inicioInscricoes: ontem,
        fimInscricoes: daquiUmMes,
        link: 'https://ufx.edu.br/e.pdf',
        ano: 2026,
        semestre: 1,
      },
    }),
  );

  await esperarRecusa(
    'Sem token nao se cria edital (401)',
    401,
    api('POST', '/editais', {
      corpo: {
        inicioInscricoes: ontem,
        fimInscricoes: daquiUmMes,
        link: 'https://ufx.edu.br/e.pdf',
        ano: 2026,
        semestre: 1,
      },
    }),
  );

  await esperarRecusa(
    'ALUNO nao lista editais pela rota administrativa (403)',
    403,
    api('GET', '/editais', { token: monitorado.token }),
  );

  const editalEditado = await esperarSucesso(
    'Professor corrige somente a data de fim',
    api('PATCH', `/editais/${edital.id}`, {
      token: professor.token,
      corpo: { fimInscricoes: somarDias(hoje, 45) },
    }),
  );

  if (editalEditado.inicioInscricoes === edital.inicioInscricoes) {
    ok('Editar o fim preserva o inicio', editalEditado.fimInscricoes);
  } else {
    falhou('A data de inicio mudou sozinha');
  }

  await esperarRecusa(
    'Editar so o fim para antes do inicio gravado e recusado (409)',
    409,
    api('PATCH', `/editais/${edital.id}`, {
      token: professor.token,
      corpo: { fimInscricoes: somarDias(hoje, -10) },
    }),
  );

  /** ------------------------------------------------------- vitrine publica */

  const abertos = await esperarSucesso(
    'GET /editais/abertos SEM token',
    api('GET', '/editais/abertos?limite=100'),
  );

  const ids = abertos.dados.map((e) => e.id);

  if (ids.includes(edital.id) && !ids.includes(editalFuturo.id)) {
    ok('A vitrine traz o aberto e omite o que ainda nao comecou', `${abertos.meta.total} aberto(s)`);
  } else {
    falhou('Vitrine publica com conteudo errado', JSON.stringify(ids));
  }

  const camposPublicos = Object.keys(abertos.dados[0] ?? {});

  if (!camposPublicos.includes('ativo') && !camposPublicos.includes('criadoEm')) {
    ok('A vitrine nao expoe `ativo` nem timestamps', camposPublicos.join(', '));
  } else {
    falhou('Campo administrativo vazou na rota publica', camposPublicos.join(', '));
  }

  /** O formulario publico precisa montar as listas sem token. */
  await esperarSucesso('GET /cursos SEM token (formulario de edital)', api('GET', '/cursos'));
  await esperarSucesso(
    'GET /disciplinas?cursoId SEM token',
    api('GET', `/disciplinas?cursoId=${curso.id}`),
  );

  const professoresPublicos = await esperarSucesso(
    'GET /professores/publicos SEM token',
    api('GET', '/professores/publicos?limite=100'),
  );

  const vazouEmail = professoresPublicos.dados.some(
    (p) => 'email' in p || 'identificacaoFuncional' in p,
  );

  if (!vazouEmail && professoresPublicos.dados.every((p) => p.usuarioId && p.nome)) {
    ok('Listagem publica de professores sem e-mail', `${professoresPublicos.meta.total} docente(s)`);
  } else {
    falhou('Dado pessoal vazou na listagem publica de professores');
  }

  await esperarRecusa(
    'GET /professores (completo) continua exigindo token (401)',
    401,
    api('GET', '/professores'),
  );

  /**
   * A busca de professor existe nas DUAS rotas, com escopos diferentes.
   *
   * A autenticada varre nome, e-mail, identificacao funcional e departamento. A
   * publica varre so nome e departamento — e as duas verificacoes abaixo que
   * provam isso sao o par: o MESMO e-mail encontra na rota com token e NAO
   * encontra na rota anonima. Se alguem acrescentar o e-mail a busca publica,
   * esta segunda passa a devolver 1 e o fluxo acusa na hora.
   *
   * Por que importa: a projecao publica omite o e-mail de proposito. Se a busca
   * o aceitasse, qualquer pessoa poderia digitar um endereco e descobrir, pelo
   * acerto ou pelo vazio, se ele pertence a um docente — o dado nao sairia na
   * resposta, mas a resposta o confirmaria.
   */
  const primeiroNome = professor.email.split('.')[0];

  const buscaComToken = await esperarSucesso(
    'Busca de professor por nome, com token',
    api('GET', `/professores?busca=${primeiroNome}&limite=100`, { token: professor.token }),
  );

  if (buscaComToken.dados.some((p) => p.id === professor.id)) {
    ok('A busca autenticada encontra por nome', `${buscaComToken.meta.total} resultado(s)`);
  } else {
    falhou('A busca autenticada nao encontrou o professor pelo nome');
  }

  const porEmailComToken = await esperarSucesso(
    'Busca de professor pelo e-mail completo, com token',
    api('GET', `/professores?busca=${encodeURIComponent(professor.email)}`, {
      token: professor.token,
    }),
  );

  if (porEmailComToken.dados.some((p) => p.email === professor.email)) {
    ok('A busca autenticada encontra por e-mail');
  } else {
    falhou('A busca autenticada nao encontrou o professor pelo e-mail');
  }

  const porNomePublico = await esperarSucesso(
    'Busca publica de professor por nome, SEM token',
    api('GET', `/professores/publicos?busca=${primeiroNome}&limite=100`),
  );

  if (porNomePublico.dados.some((p) => p.usuarioId === professor.id)) {
    ok('A busca publica encontra por nome', `${porNomePublico.meta.total} resultado(s)`);
  } else {
    falhou('A busca publica nao encontrou o professor pelo nome');
  }

  const porEmailPublico = await esperarSucesso(
    'Busca publica pelo MESMO e-mail, SEM token',
    api('GET', `/professores/publicos?busca=${encodeURIComponent(professor.email)}`),
  );

  if (porEmailPublico.meta.total === 0) {
    ok('A rota publica NAO confirma e-mail de docente', '0 resultados, como deve ser');
  } else {
    falhou(
      'A busca publica confirmou um e-mail',
      `${porEmailPublico.meta.total} resultado(s) para ${professor.email}`,
    );
  }

  await esperarRecusa(
    'Termo de busca acima de 150 caracteres e recusado (400)',
    400,
    api('GET', `/professores?busca=${'a'.repeat(151)}`, { token: professor.token }),
  );

  await esperarRecusa(
    'Termo acima de 150 caracteres tambem e recusado na rota publica (400)',
    400,
    api('GET', `/professores/publicos?busca=${'a'.repeat(151)}`),
  );

  /** ------------------------------------------------- inscricao publica */

  const rota = `/editais/${edital.id}/inscricoes`;
  const matriculaCandidato = `C1${SUFIXO}`;
  const emailCandidato = `candidato.um.${SUFIXO}@ufx.edu.br`;

  const base = {
    cursoId: curso.id,
    disciplinaId: disciplina.id,
    professorId: professor.id,
    turno: 'NOTURNO',
  };

  const inscricao = await esperarSucesso(
    'Candidato se inscreve SEM autenticacao',
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        nomeCompleto: 'Candidato Um da Silva',
        matricula: matriculaCandidato,
        email: emailCandidato,
        n1: '8.5',
        n2: '9.25',
      },
    }),
  );

  const camposDaConfirmacao = Object.keys(inscricao);

  if (
    inscricao.id &&
    !camposDaConfirmacao.includes('n1') &&
    !camposDaConfirmacao.includes('media') &&
    !camposDaConfirmacao.includes('boletim')
  ) {
    ok('A confirmacao publica devolve o minimo', camposDaConfirmacao.join(', '));
  } else {
    falhou('A confirmacao publica expoe mais do que deveria', camposDaConfirmacao.join(', '));
  }

  await esperarRecusa(
    'Enviar `media` na requisicao e recusado (400)',
    400,
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        nomeCompleto: 'Candidato Media Forjada',
        matricula: `C2${SUFIXO}`,
        email: `media.${SUFIXO}@ufx.edu.br`,
        n1: '1',
        n2: '1',
        media: '10',
      },
    }),
  );

  await esperarRecusa(
    'Nota acima de 10 e recusada (400)',
    400,
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        nomeCompleto: 'Candidato Nota Alta',
        matricula: `C3${SUFIXO}`,
        email: `alta.${SUFIXO}@ufx.edu.br`,
        n1: '10.5',
      },
    }),
  );

  await esperarRecusa(
    'Nota com 3 casas decimais e recusada (400)',
    400,
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        nomeCompleto: 'Candidato Tres Casas',
        matricula: `C4${SUFIXO}`,
        email: `casas.${SUFIXO}@ufx.edu.br`,
        n1: '8.333',
      },
    }),
  );

  await esperarRecusa(
    'Disciplina que o curso nao oferece e recusada (409)',
    409,
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        cursoId: cursoVizinho.id,
        nomeCompleto: 'Candidato Curso Errado',
        matricula: `C5${SUFIXO}`,
        email: `curso.${SUFIXO}@ufx.edu.br`,
      },
    }),
  );

  await esperarRecusa(
    'Professor responsavel inexistente e recusado (404)',
    404,
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        professorId: '00000000-0000-4000-8000-000000000000',
        nomeCompleto: 'Candidato Sem Orientador',
        matricula: `C6${SUFIXO}`,
        email: `orientador.${SUFIXO}@ufx.edu.br`,
      },
    }),
  );

  await esperarRecusa(
    'Inscricao em edital que ainda nao abriu e recusada (409)',
    409,
    apiArquivo('POST', `/editais/${editalFuturo.id}/inscricoes`, {
      campos: {
        ...base,
        nomeCompleto: 'Candidato Antecipado',
        matricula: `C7${SUFIXO}`,
        email: `antecipado.${SUFIXO}@ufx.edu.br`,
      },
    }),
  );

  await esperarRecusa(
    'Mesma matricula no mesmo edital e recusada (409)',
    409,
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        nomeCompleto: 'Candidato Repetido',
        matricula: matriculaCandidato,
        email: `outro.${SUFIXO}@ufx.edu.br`,
      },
    }),
  );

  await esperarRecusa(
    'Mesmo e-mail no mesmo edital e recusado (409)',
    409,
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        nomeCompleto: 'Candidato Repetido Dois',
        matricula: `C8${SUFIXO}`,
        email: emailCandidato,
      },
    }),
  );

  await esperarRecusa(
    'Inscricao sem o boletim e recusada (400)',
    400,
    apiArquivo('POST', rota, {
      semArquivo: true,
      campos: {
        ...base,
        nomeCompleto: 'Candidato Sem Boletim',
        matricula: `C9${SUFIXO}`,
        email: `semboletim.${SUFIXO}@ufx.edu.br`,
      },
    }),
  );

  await esperarRecusa(
    'Arquivo declarado como PDF mas sem a assinatura e recusado (400)',
    400,
    apiArquivo('POST', rota, {
      conteudo: Buffer.from('MZ este nao e um PDF'),
      campos: {
        ...base,
        nomeCompleto: 'Candidato Executavel',
        matricula: `CA${SUFIXO}`,
        email: `exe.${SUFIXO}@ufx.edu.br`,
      },
    }),
  );

  await esperarRecusa(
    'Arquivo com tipo diferente de application/pdf e recusado (400)',
    400,
    apiArquivo('POST', rota, {
      tipo: 'image/png',
      campos: {
        ...base,
        nomeCompleto: 'Candidato Imagem',
        matricula: `CB${SUFIXO}`,
        email: `png.${SUFIXO}@ufx.edu.br`,
      },
    }),
  );

  /**
   * Inscricao de quem JA e aluno cadastrado, com a matricula dele.
   *
   * Nenhum dado e reaproveitado automaticamente — o candidato digita tudo —, e
   * o cruzamento aparece em `alunoCadastrado` na consulta do professor. E o que
   * permite ao professor saber de quem ele nao precisa criar conta ao aprovar.
   */
  const matriculaDoAluno = await matriculaDe(monitorado.id);

  const inscricaoDeAluno = await esperarSucesso(
    'Aluno JA cadastrado tambem se inscreve (sem token)',
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        /**
         * Mesma disciplina da inscricao seguinte, e com o E-MAIL e a MATRICULA
         * reais do aluno. Os dois detalhes sao o que a aprovacao precisa: a
         * disciplina compartilhada nao tem monitoria aberta a mao, e o e-mail
         * existente e a chave pela qual a conta e reaproveitada.
         */
        disciplinaId: compartilhada.id,
        /** Indicada a Prof Maria: a monitoria tem de nascer no nome DELA. */
        professorId: profMaria.id,
        nomeCompleto: 'Carlos Monitorado Pereira',
        matricula: matriculaDoAluno,
        email: monitorado.email,
        n1: '7',
        n2: '6',
      },
    }),
  );

  /** Sem nota nenhuma: a media tem de ficar NULA, nunca zero. */
  const inscricaoSemNotas = await esperarSucesso(
    'Inscricao sem informar nota nenhuma',
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        turno: 'MATUTINO',
        nomeCompleto: 'Candidato Sem Notas',
        matricula: `CC${SUFIXO}`,
        email: `semnotas.${SUFIXO}@ufx.edu.br`,
        n1: '',
        n2: '',
      },
    }),
  );

  /**
   * Uma candidatura em OUTRA disciplina.
   *
   * Sem ela o edital teria um grupo so e o agrupamento passaria por acidente:
   * um resumo que ignorasse o GROUP BY devolveria exatamente a mesma linha.
   * `compartilhada` e oferecida pelo curso do candidato, entao a FK composta
   * aceita.
   */
  const inscricaoDeOutraDisciplina = await esperarSucesso(
    'Inscricao em uma segunda disciplina do mesmo edital',
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        disciplinaId: compartilhada.id,
        /** Mesma indicacao da outra, para a oferta ser a mesma e ser reusada. */
        professorId: profMaria.id,
        turno: 'VESPERTINO',
        nomeCompleto: 'Candidato Outra Disciplina',
        matricula: `CE${SUFIXO}`,
        email: `outradisc.${SUFIXO}@ufx.edu.br`,
        n1: '10',
        n2: '9',
      },
    }),
  );

  /**
   * Terceira candidatura na disciplina compartilhada, indicando o professor de
   * BOOTSTRAP — e nao a Prof Maria. A oferta dela, portanto, e outra, e e nela
   * que a ADOCAO de monitoria vai ser exercitada.
   */
  const inscricaoParaAdocao = await esperarSucesso(
    'Inscricao cuja oferta tera monitoria aberta a mao',
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        disciplinaId: compartilhada.id,
        nomeCompleto: 'Candidato Da Adocao',
        matricula: `CF${SUFIXO}`,
        email: `adocao.${SUFIXO}@ufx.edu.br`,
        n1: '5',
        n2: '5',
      },
    }),
  );

  /** ----------------------------------------- nada foi criado em alunos/usuarios */

  const vazamento = await contarIdentidades(emailCandidato, matriculaCandidato);

  if (vazamento.usuarios === 0 && vazamento.alunos === 0) {
    ok('A inscricao NAO criou linha em `usuarios` nem em `alunos`');
  } else {
    falhou('A inscricao criou identidade', JSON.stringify(vazamento));
  }

  /** ------------------------------------------------ consulta administrativa */

  await esperarRecusa('Listar inscricoes sem token (401)', 401, api('GET', '/inscricoes'));
  await esperarRecusa(
    'ALUNO nao lista inscricoes (403)',
    403,
    api('GET', '/inscricoes', { token: monitorado.token }),
  );

  const lista = await esperarSucesso(
    'Professor lista as inscricoes do edital',
    api('GET', `/inscricoes?editalId=${edital.id}&limite=100`, { token: professor.token }),
  );

  if (lista.meta.total === 5) {
    ok('As 5 inscricoes validas estao na lista');
  } else {
    falhou(`Esperava 5 inscricoes, veio ${lista.meta.total}`);
  }

  const principal = lista.dados.find((i) => i.id === inscricao.id);

  if (principal?.media === 8.88) {
    ok('Media calculada pelo banco', `(8.5 + 9.25) / 2 = ${principal.media}`);
  } else {
    falhou('Media fora do esperado (8.88)', String(principal?.media));
  }

  const semNotas = lista.dados.find((i) => i.id === inscricaoSemNotas.id);

  if (semNotas?.n1 === null && semNotas?.media === null) {
    ok('Nota ausente deixa a media NULA — nunca zero');
  } else {
    falhou('Nota ausente virou numero', JSON.stringify({ n1: semNotas?.n1, media: semNotas?.media }));
  }

  const doAluno = lista.dados.find((i) => i.id === inscricaoDeAluno.id);

  if (doAluno?.alunoCadastrado?.usuarioId === monitorado.id) {
    ok('Candidato que ja tem conta e reconhecido pela matricula');
  } else {
    falhou('alunoCadastrado nao resolveu', JSON.stringify(doAluno?.alunoCadastrado));
  }

  if (principal?.alunoCadastrado === null) {
    ok('Candidato sem conta aparece com alunoCadastrado nulo');
  } else {
    falhou('Candidato de fora foi associado a um aluno', JSON.stringify(principal?.alunoCadastrado));
  }

  if (principal?.boletim?.tamanhoBytes > 0 && !('conteudo' in (principal?.boletim ?? {}))) {
    ok('A listagem traz metadado do boletim, nunca os bytes', principal.boletim.nomeOriginal);
  } else {
    falhou('Boletim exposto de forma errada na listagem', JSON.stringify(principal?.boletim));
  }

  /** ---------------------------------------------- filtros e ordenacoes */

  const porTurno = await esperarSucesso(
    'Filtro por turno',
    api('GET', `/inscricoes?editalId=${edital.id}&turno=MATUTINO`, { token: professor.token }),
  );

  if (porTurno.meta.total === 1 && porTurno.dados[0].turno === 'MATUTINO') {
    ok('Filtro por turno recorta corretamente');
  } else {
    falhou(`Filtro por turno trouxe ${porTurno.meta.total} item(ns)`);
  }

  const porCurso = await esperarSucesso(
    'Filtro por curso',
    api('GET', `/inscricoes?cursoId=${curso.id}&editalId=${edital.id}`, { token: professor.token }),
  );

  const porCursoVizinho = await esperarSucesso(
    'Filtro por curso que nao tem inscricao',
    api('GET', `/inscricoes?cursoId=${cursoVizinho.id}&editalId=${edital.id}`, {
      token: professor.token,
    }),
  );

  if (porCurso.meta.total === 5 && porCursoVizinho.meta.total === 0) {
    ok('Filtro por curso separa os conjuntos');
  } else {
    falhou(`Filtro por curso: ${porCurso.meta.total} e ${porCursoVizinho.meta.total}`);
  }

  const porDisciplina = await esperarSucesso(
    'Filtro por disciplina',
    api('GET', `/inscricoes?disciplinaId=${disciplina.id}&editalId=${edital.id}`, {
      token: professor.token,
    }),
  );

  if (porDisciplina.meta.total === 2) {
    ok('Filtro por disciplina recorta corretamente');
  } else {
    falhou(`Filtro por disciplina trouxe ${porDisciplina.meta.total}`);
  }

  const porProfessor = await esperarSucesso(
    'Filtro por professor responsavel',
    api('GET', `/inscricoes?professorId=${professor.id}&editalId=${edital.id}`, {
      token: professor.token,
    }),
  );

  const porProfessorIndicado = await esperarSucesso(
    'Filtro pelo outro professor responsavel',
    api('GET', `/inscricoes?professorId=${profMaria.id}&editalId=${edital.id}`, {
      token: professor.token,
    }),
  );

  if (porProfessor.meta.total === 3 && porProfessorIndicado.meta.total === 2) {
    ok('Filtro por professor responsavel separa as indicacoes', '3 + 2');
  } else {
    falhou(
      `Filtro por professor: ${porProfessor.meta.total} e ${porProfessorIndicado.meta.total}`,
    );
  }

  const porBusca = await esperarSucesso(
    'Busca por matricula',
    api('GET', `/inscricoes?editalId=${edital.id}&busca=${matriculaCandidato}`, {
      token: professor.token,
    }),
  );

  if (porBusca.meta.total === 1 && porBusca.dados[0].id === inscricao.id) {
    ok('Busca encontra por matricula');
  } else {
    falhou(`Busca por matricula trouxe ${porBusca.meta.total}`);
  }

  const porNome = await esperarSucesso(
    'Busca por parte do nome',
    api('GET', `/inscricoes?editalId=${edital.id}&busca=da Silva`, { token: professor.token }),
  );

  if (porNome.meta.total === 1) {
    ok('Busca encontra por nome parcial');
  } else {
    falhou(`Busca por nome trouxe ${porNome.meta.total}`);
  }

  const porPeriodo = await esperarSucesso(
    'Filtro por ano e semestre do edital',
    api('GET', '/inscricoes?ano=2026&semestre=2&limite=100', { token: professor.token }),
  );

  const porPeriodoErrado = await esperarSucesso(
    'Filtro por periodo sem inscricao',
    api('GET', '/inscricoes?ano=2027&semestre=1', { token: professor.token }),
  );

  if (porPeriodo.meta.total >= 5 && porPeriodoErrado.meta.total === 0) {
    ok('Filtro por periodo do edital funciona pelo JOIN');
  } else {
    falhou(`Periodo: ${porPeriodo.meta.total} e ${porPeriodoErrado.meta.total}`);
  }

  const desc = await esperarSucesso(
    'Ordenacao por media decrescente',
    api('GET', `/inscricoes?editalId=${edital.id}&ordenarPor=media&direcao=desc`, {
      token: professor.token,
    }),
  );

  const asc = await esperarSucesso(
    'Ordenacao por media crescente',
    api('GET', `/inscricoes?editalId=${edital.id}&ordenarPor=media&direcao=asc`, {
      token: professor.token,
    }),
  );

  const mediasDesc = desc.dados.map((i) => i.media);
  const mediasAsc = asc.dados.map((i) => i.media);

  if (JSON.stringify(mediasDesc) === JSON.stringify([9.5, 8.88, 6.5, 5, null])) {
    ok('DESC: maior media primeiro, nota ausente no fim', JSON.stringify(mediasDesc));
  } else {
    falhou('Ordem decrescente inesperada', JSON.stringify(mediasDesc));
  }

  if (JSON.stringify(mediasAsc) === JSON.stringify([5, 6.5, 8.88, 9.5, null])) {
    ok('ASC: menor media primeiro, nota ausente AINDA no fim', JSON.stringify(mediasAsc));
  } else {
    falhou('Ordem crescente inesperada', JSON.stringify(mediasAsc));
  }

  const porNomeOrdenado = await esperarSucesso(
    'Ordenacao por nome do candidato',
    api('GET', `/inscricoes?editalId=${edital.id}&ordenarPor=nome&direcao=asc`, {
      token: professor.token,
    }),
  );

  const nomes = porNomeOrdenado.dados.map((i) => i.nomeCompleto);

  if (JSON.stringify(nomes) === JSON.stringify([...nomes].sort((a, b) => a.localeCompare(b, 'pt')))) {
    ok('Ordenacao por nome em ordem alfabetica', nomes.join(' | '));
  } else {
    falhou('Ordem alfabetica incorreta', nomes.join(' | '));
  }

  await esperarRecusa(
    'Campo de ordenacao fora da lista e recusado (400)',
    400,
    api('GET', `/inscricoes?ordenarPor=senha_hash`, { token: professor.token }),
  );

  await esperarRecusa(
    'Limite acima de 100 e recusado (400)',
    400,
    api('GET', '/inscricoes?limite=1000', { token: professor.token }),
  );

  const pagina1 = await esperarSucesso(
    'Paginacao: pagina 1 com limite 2',
    api('GET', `/inscricoes?editalId=${edital.id}&limite=2&pagina=1&ordenarPor=matricula&direcao=asc`, {
      token: professor.token,
    }),
  );

  const pagina2 = await esperarSucesso(
    'Paginacao: pagina 2 com limite 2',
    api('GET', `/inscricoes?editalId=${edital.id}&limite=2&pagina=2&ordenarPor=matricula&direcao=asc`, {
      token: professor.token,
    }),
  );

  const repetida = pagina1.dados.some((a) => pagina2.dados.some((b) => a.id === b.id));

  if (pagina1.dados.length === 2 && pagina2.dados.length === 2 && !repetida) {
    ok('Paginacao no banco, sem item repetido entre paginas');
  } else {
    falhou('Paginacao inconsistente', `${pagina1.dados.length} + ${pagina2.dados.length}`);
  }


  /** ------------------------------------------- resumo agrupado por disciplina */

  await esperarRecusa('Resumo sem token (401)', 401, api('GET', '/inscricoes/resumo'));
  await esperarRecusa(
    'ALUNO nao consulta o resumo (403)',
    403,
    api('GET', '/inscricoes/resumo', { token: monitorado.token }),
  );

  const resumo = await esperarSucesso(
    'Professor consulta o resumo por disciplina',
    api('GET', `/inscricoes/resumo?editalId=${edital.id}`, { token: professor.token }),
  );

  if (Array.isArray(resumo) && resumo.length === 2) {
    ok('O resumo traz um grupo por disciplina', resumo.map((g) => g.disciplina.codigo).join(' + '));
  } else {
    falhou('Agrupamento inesperado', JSON.stringify(resumo).slice(0, 160));
  }

  const somaDosGrupos = resumo.reduce((total, grupo) => total + grupo.totalInscricoes, 0);

  if (somaDosGrupos === lista.meta.total) {
    ok('A soma dos grupos e o total do edital', `${somaDosGrupos} = ${lista.meta.total}`);
  } else {
    falhou(`Soma dos grupos ${somaDosGrupos} != total ${lista.meta.total}`);
  }

  /**
   * O CONTRATO do resumo: cada total e o que o endpoint plano devolve para
   * aquela disciplina. Se os dois discordarem, o cabecalho do acordeao mente —
   * e e o cabecalho que a banca le antes de abrir o grupo.
   */
  let totaisConferem = true;

  for (const grupo of resumo) {
    const doGrupo = await api(
      'GET',
      `/inscricoes?editalId=${edital.id}&disciplinaId=${grupo.disciplina.id}&limite=100`,
      { token: professor.token },
    );

    if (doGrupo.dados?.meta?.total !== grupo.totalInscricoes) {
      totaisConferem = false;
      falhou(
        `Grupo ${grupo.disciplina.codigo}: resumo diz ${grupo.totalInscricoes}, ` +
          `lista diz ${doGrupo.dados?.meta?.total}`,
      );
    }
  }

  if (totaisConferem) {
    ok('Cada total do resumo bate com a listagem daquela disciplina');
  }

  if (resumo.every((g) => g.monitoriaCadastrada === false && g.monitoriaId === null)) {
    ok('Antes de aprovar, nenhuma disciplina tem monitoria cadastrada');
  } else {
    falhou('Grupo marcado como resolvido antes de qualquer aprovacao', JSON.stringify(resumo));
  }

  const comESemMedia = resumo.every((g) => g.comMedia + g.semMedia === g.totalInscricoes);

  if (comESemMedia) {
    ok('comMedia + semMedia = totalInscricoes em todos os grupos');
  } else {
    falhou('As contagens de media nao fecham', JSON.stringify(resumo));
  }

  /** O candidato sem notas tem de aparecer como `semMedia`, nunca como media zero. */
  const grupoDaPrimeira = resumo.find((g) => g.disciplina.id === disciplina.id);

  if (grupoDaPrimeira?.semMedia === 1 && grupoDaPrimeira?.melhorMedia === 8.88) {
    ok('Nota ausente conta em semMedia e nao afeta a melhor media', `${grupoDaPrimeira.semMedia}`);
  } else {
    falhou('Resumo da disciplina principal inesperado', JSON.stringify(grupoDaPrimeira));
  }

  /** Os filtros tem de valer no resumo, senao o cabecalho descreve outro recorte. */
  const resumoFiltrado = await esperarSucesso(
    'Resumo com filtro de turno',
    api('GET', `/inscricoes/resumo?editalId=${edital.id}&turno=VESPERTINO`, {
      token: professor.token,
    }),
  );

  if (
    resumoFiltrado.length === 1 &&
    resumoFiltrado[0].disciplina.id === compartilhada.id &&
    resumoFiltrado[0].totalInscricoes === 1
  ) {
    ok('O filtro recorta o resumo do mesmo jeito que recorta a lista');
  } else {
    falhou('Resumo filtrado inesperado', JSON.stringify(resumoFiltrado));
  }

  /**
   * O resumo nao pagina, e isso tem de ser EXPLICITO: `forbidNonWhitelisted`
   * devolve 400 em vez de aceitar `pagina` e ignorar em silencio.
   */
  for (const parametro of ['pagina=2', 'limite=5', 'ordenarPor=media', 'direcao=asc']) {
    await esperarRecusa(
      `Resumo recusa ${parametro.split('=')[0]} (400)`,
      400,
      api('GET', `/inscricoes/resumo?${parametro}`, { token: professor.token }),
    );
  }

  const resumoVazio = await esperarSucesso(
    'Resumo de um edital sem candidatura',
    api('GET', `/inscricoes/resumo?editalId=${editalFuturo.id}`, { token: professor.token }),
  );

  if (Array.isArray(resumoVazio) && resumoVazio.length === 0) {
    ok('Edital sem candidatura devolve lista vazia, nao erro');
  } else {
    falhou('Resumo vazio inesperado', JSON.stringify(resumoVazio));
  }



  /**
   * `professorId` mora no DTO de criacao de monitoria, mas e preenchido pelo
   * CONTROLLER. Se o cliente puder manda-lo, qualquer professor cria monitoria
   * no nome de outro por `POST /monitorias` — e e justamente por isso que o
   * campo nao tem decorator de validacao: o `forbidNonWhitelisted` o recusa.
   */
  await esperarRecusa(
    'Cliente NAO escolhe o professor da monitoria (400)',
    400,
    api('POST', '/monitorias', {
      token: professor.token,
      corpo: {
        disciplinaId: compartilhada.id,
        professorId: profMaria.id,
        ano: 2028,
        semestre: 1,
      },
    }),
  );

  /**
   * Monitoria aberta A MAO para a oferta de `inscricaoParaAdocao`, antes de
   * qualquer aprovacao. E o fluxo do professor que prepara a monitoria e so
   * depois roda a selecao — e o que a aprovacao vai ADOTAR, em vez de recusar.
   */
  const semEdital = await esperarSucesso(
    'Criar monitoria direta continua funcionando (sem edital)',
    api('POST', '/monitorias', {
      token: professor.token,
      corpo: { disciplinaId: compartilhada.id, ano: 2026, semestre: 2 },
    }),
  );

  if (semEdital.editalId === null) {
    ok('Monitoria criada direto nasce com editalId nulo');
  } else {
    falhou('editalId inesperado em monitoria sem edital', String(semEdital.editalId));
  }

  /** ----------------------------------- aprovacao: a selecao vira monitoria */

  await esperarRecusa(
    'Aprovar sem token (401)',
    401,
    api('POST', `/inscricoes/${inscricao.id}/aprovar`),
  );

  await esperarRecusa(
    'ALUNO nao aprova candidatura (403)',
    403,
    api('POST', `/inscricoes/${inscricao.id}/aprovar`, { token: monitorado.token }),
  );

  /**
   * A oferta da disciplina principal tem monitoria deste professor em 2026/2 —
   * a da secao 2, que a secao 9 ENCERROU. Reaproveitar uma monitoria encerrada
   * nao e opcao: ela nao aceita participante. A recusa vem ANTES de gravar
   * `edital_id`, senao o resumo passaria a mostrar "monitoria aberta, monitor
   * pendente" em um caso em que nenhuma tentativa vai funcionar.
   */
  await esperarRecusa(
    'Aprovar com a monitoria da oferta ENCERRADA e recusado (409)',
    409,
    api('POST', `/inscricoes/${inscricao.id}/aprovar`, { token: professor.token }),
  );

  const aprovacao = await esperarSucesso(
    'Professor aprova o candidato SEM conta',
    api('POST', `/inscricoes/${inscricaoDeOutraDisciplina.id}/aprovar`, {
      token: professor.token,
    }),
  );

  if (
    aprovacao.monitoria?.origem === 'CRIADA' &&
    aprovacao.monitor?.contaCriada === true &&
    aprovacao.monitoria.ano === 2026 &&
    aprovacao.monitoria.semestre === 2
  ) {
    ok('Monitoria e conta criadas, com o periodo do edital', `monitoria ${aprovacao.monitoria.id}`);
  } else {
    falhou('Aprovacao com resultado inesperado', JSON.stringify(aprovacao));
  }

  const gravado = await conferirAprovacao(aprovacao, edital.id);

  if (gravado.editalDaMonitoria === edital.id) {
    ok('A monitoria aponta para o edital que a originou');
  } else {
    falhou('monitorias.edital_id nao foi preenchido', String(gravado.editalDaMonitoria));
  }

  if (
    gravado.professorDaMonitoria === profMaria.id &&
    gravado.professorDaMonitoria !== professor.id
  ) {
    ok('O responsavel e o professor INDICADO na inscricao, nao quem aprovou');
  } else {
    falhou('Responsavel inesperado', String(gravado.professorDaMonitoria));
  }

  /**
   * O ato, porem, e de quem aprovou. Os dois valores juntos sao a trilha: a
   * monitoria e da Prof Maria, e a habilitacao partiu de quem conduziu a banca.
   */
  if (gravado.vinculo?.habilitado_por === professor.id) {
    ok('A habilitacao ficou registrada no nome de quem aprovou');
  } else {
    falhou('habilitado_por inesperado', JSON.stringify(gravado.vinculo));
  }

  if (gravado.vinculo?.papel === 'MONITOR' && gravado.vinculo?.status === 'ATIVO') {
    ok('O candidato virou MONITOR ativo da monitoria');
  } else {
    falhou('Vinculo de monitor inesperado', JSON.stringify(gravado.vinculo));
  }

  if (gravado.contaDoCandidato?.matricula === `CE${SUFIXO}`) {
    ok('A conta nasceu com os dados da inscricao', gravado.contaDoCandidato.email);
  } else {
    falhou('Conta criada com dados divergentes', JSON.stringify(gravado.contaDoCandidato));
  }

  /**
   * Segundo aprovado da MESMA disciplina, e com e-mail que ja tem conta. Os
   * dois reaproveitamentos acontecem de uma vez: a monitoria nao e recriada
   * (seria impossivel) e o aluno nao e cadastrado de novo.
   */
  const usuariosAntes = await contarUsuarios();

  const segunda = await esperarSucesso(
    'Professor aprova o candidato que JA tem conta',
    api('POST', `/inscricoes/${inscricaoDeAluno.id}/aprovar`, { token: professor.token }),
  );

  if (segunda.monitoria?.origem === 'REUSADA' && segunda.monitoria.id === aprovacao.monitoria.id) {
    ok('A monitoria da disciplina foi reaproveitada, nao duplicada');
  } else {
    falhou('Criou monitoria duplicada para a mesma oferta', JSON.stringify(segunda.monitoria));
  }

  if (segunda.monitor?.contaCriada === false && segunda.monitor.usuarioId === monitorado.id) {
    ok('A conta existente foi reaproveitada pelo e-mail da inscricao');
  } else {
    falhou('Nao reaproveitou a conta', JSON.stringify(segunda.monitor));
  }

  if ((await contarUsuarios()) === usuariosAntes) {
    ok('Nenhum usuario novo foi criado na segunda aprovacao');
  } else {
    falhou('A segunda aprovacao criou identidade');
  }

  await esperarRecusa(
    'Aprovar de novo quem ja e monitor e recusado (409, RN09)',
    409,
    api('POST', `/inscricoes/${inscricaoDeAluno.id}/aprovar`, { token: professor.token }),
  );

  /**
   * ADOCAO: a oferta ja tinha monitoria aberta a mao, sem edital. A aprovacao
   * usa aquela mesma monitoria e grava nela a procedencia — e e por isso que a
   * marca de "resolvido" no resumo passa a valer. Recusar aqui pediria trabalho
   * manual sem razao de dominio: a oferta e a mesma e o banco garante que
   * existe so uma.
   */
  const adocao = await esperarSucesso(
    'Professor aprova em oferta com monitoria aberta a mao',
    api('POST', `/inscricoes/${inscricaoParaAdocao.id}/aprovar`, { token: professor.token }),
  );

  if (adocao.monitoria?.origem === 'ADOTADA' && adocao.monitoria.id === semEdital.id) {
    ok('A monitoria aberta a mao foi ADOTADA, nao duplicada', semEdital.id);
  } else {
    falhou('Adocao inesperada', JSON.stringify(adocao.monitoria));
  }

  const adotada = await conferirAprovacao(adocao, edital.id);

  if (adotada.editalDaMonitoria === edital.id) {
    ok('A adocao gravou o edital na monitoria que ja existia');
  } else {
    falhou('edital_id nao foi gravado na adocao', String(adotada.editalDaMonitoria));
  }

  if (adotada.professorDaMonitoria === professor.id) {
    ok('A adocao NAO trocou o dono da monitoria');
  } else {
    falhou('A adocao mexeu no responsavel', String(adotada.professorDaMonitoria));
  }

  /** O resumo passa a distinguir o que foi resolvido do que falta. */
  const resumoDepois = await esperarSucesso(
    'Resumo depois das aprovacoes',
    api('GET', `/inscricoes/resumo?editalId=${edital.id}`, { token: professor.token }),
  );

  const resolvido = resumoDepois.find((g) => g.disciplina.id === compartilhada.id);
  const pendente = resumoDepois.find((g) => g.disciplina.id === disciplina.id);

  if (resolvido?.monitoriaCadastrada === true && resolvido.monitoresHabilitados === 2) {
    ok('O grupo resolvido aparece com os dois monitores', resolvido.disciplina.codigo);
  } else {
    falhou('Grupo resolvido inesperado', JSON.stringify(resolvido));
  }

  if (pendente?.monitoriaCadastrada === false && pendente.monitoriaId === null) {
    ok('O grupo sem aprovacao continua pendente', pendente.disciplina.codigo);
  } else {
    falhou('Grupo pendente inesperado', JSON.stringify(pendente));
  }

  /**
   * A monitoria criada a mao na secao 2 nao pode acender o flag: ela e da
   * mesma disciplina e do mesmo periodo, mas tem `edital_id` nulo.
   */
  if (pendente?.monitoresHabilitados === 0) {
    ok('Monitoria aberta fora do edital nao conta como resolvida pelo edital');
  } else {
    falhou('Monitoria sem edital contou no resumo', JSON.stringify(pendente));
  }


  /** ------------------------------------------------------------- detalhe */

  const detalhe = await esperarSucesso(
    'Professor detalha a inscricao',
    api('GET', `/inscricoes/${inscricao.id}`, { token: professor.token }),
  );

  if (
    detalhe.curso?.codigo === curso.codigo &&
    detalhe.disciplina?.id === disciplina.id &&
    detalhe.professor?.usuarioId === professor.id &&
    detalhe.edital?.id === edital.id
  ) {
    ok('As quatro FKs voltam resolvidas no detalhe');
  } else {
    falhou('FK nao resolvida no detalhe', JSON.stringify(detalhe));
  }

  await esperarRecusa(
    'ALUNO nao detalha inscricao de outro (403)',
    403,
    api('GET', `/inscricoes/${inscricao.id}`, { token: monitorado.token }),
  );

  /** ------------------------------------------------------- boletim em PDF */

  await esperarRecusa(
    'Baixar boletim sem token (401)',
    401,
    api('GET', `/inscricoes/${inscricao.id}/boletim`),
  );

  await esperarRecusa(
    'ALUNO nao baixa boletim de candidato (403)',
    403,
    api('GET', `/inscricoes/${inscricao.id}/boletim`, { token: monitorado.token }),
  );

  const download = await fetch(`${BASE}/inscricoes/${inscricao.id}/boletim`, {
    headers: { Authorization: `Bearer ${professor.token}` },
  });

  const bytes = Buffer.from(await download.arrayBuffer());
  const disposicao = download.headers.get('content-disposition') ?? '';

  if (
    download.status === 200 &&
    download.headers.get('content-type') === 'application/pdf' &&
    disposicao.startsWith('attachment;') &&
    bytes.subarray(0, 5).toString() === '%PDF-'
  ) {
    ok('Professor baixa o PDF como anexo', `${bytes.length} bytes | ${disposicao}`);
  } else {
    falhou(
      'Download do boletim fora do esperado',
      `HTTP ${download.status} | ${download.headers.get('content-type')} | ${disposicao}`,
    );
  }

  if ((download.headers.get('cache-control') ?? '').includes('no-store')) {
    ok('Boletim servido com no-store');
  } else {
    falhou('Boletim sem no-store', download.headers.get('cache-control'));
  }

  /** --------------------------------- a media e intocavel, inclusive por SQL */

  const recusaDoBanco = await tentarSobrescreverMedia(inscricao.id);

  if (recusaDoBanco) {
    ok('O BANCO recusa UPDATE na media (coluna gerada)', recusaDoBanco.slice(0, 80));
  } else {
    falhou('O banco ACEITOU sobrescrever a media');
  }

  /** ----------------------------------------------- exclusao logica (RN10) */

  await esperarSucesso(
    'Professor exclui o edital (DELETE)',
    api('DELETE', `/editais/${edital.id}`, { token: professor.token }),
  );

  const aindaExiste = await editalAindaNoBanco(edital.id);

  if (aindaExiste && aindaExiste.ativo === false) {
    ok('DELETE nao apagou a linha: apenas `ativo = false` (RN10)');
  } else {
    falhou('O edital foi removido do banco', JSON.stringify(aindaExiste));
  }

  const abertosDepois = await esperarSucesso(
    'Vitrine publica apos a exclusao',
    api('GET', '/editais/abertos?limite=100'),
  );

  if (!abertosDepois.dados.some((e) => e.id === edital.id)) {
    ok('Edital excluido sai da vitrine publica');
  } else {
    falhou('Edital excluido continua na vitrine');
  }

  await esperarRecusa(
    'Inscricao em edital excluido e recusada (404)',
    404,
    apiArquivo('POST', rota, {
      campos: {
        ...base,
        nomeCompleto: 'Candidato Atrasado',
        matricula: `CD${SUFIXO}`,
        email: `atrasado.${SUFIXO}@ufx.edu.br`,
      },
    }),
  );

  const inscricoesDoExcluido = await esperarSucesso(
    'As inscricoes do edital excluido continuam consultaveis',
    api('GET', `/inscricoes?editalId=${edital.id}`, { token: professor.token }),
  );

  if (inscricoesDoExcluido.meta.total === 5) {
    ok('Exclusao do edital nao apagou candidatura nenhuma (RN10)');
  } else {
    falhou(`Esperava 5 inscricoes preservadas, veio ${inscricoesDoExcluido.meta.total}`);
  }

  const reativado = await esperarSucesso(
    'Professor reativa o edital por PATCH',
    api('PATCH', `/editais/${edital.id}`, { token: professor.token, corpo: { ativo: true } }),
  );

  if (reativado.ativo === true && reativado.aceitandoInscricoes === true) {
    ok('Reativacao devolve o edital a vitrine');
  } else {
    falhou('Reativacao nao surtiu efeito', JSON.stringify(reativado));
  }

  await esperarSucesso(
    'Exclusao e idempotente (segundo DELETE)',
    api('DELETE', `/editais/${edital.id}`, { token: professor.token }),
  );
  await esperarSucesso(
    'Terceiro DELETE tambem devolve 204',
    api('DELETE', `/editais/${edital.id}`, { token: professor.token }),
  );
}

/** ----------------------------------------------------------- utilitarios */

/**
 * Multipart, montado com FormData nativo do Node.
 *
 * O Content-Type NAO e definido a mao de proposito: o `fetch` o escreve junto
 * com o boundary, e um boundary errado derruba o parsing no multer antes de
 * qualquer validacao da aplicacao.
 */
async function apiArquivo(metodo, caminho, { campos, token, conteudo, tipo, semArquivo } = {}) {
  const form = new FormData();

  for (const [chave, valor] of Object.entries(campos ?? {})) {
    form.append(chave, String(valor));
  }

  if (!semArquivo) {
    const bytes = conteudo ?? pdfDeTeste();

    form.append(
      'boletim',
      new Blob([bytes], { type: tipo ?? 'application/pdf' }),
      'boletim-notas.pdf',
    );
  }

  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
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

/** PDF minimo, valido o bastante para a assinatura e para abrir em leitor. */
function pdfDeTeste() {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF\n',
    'latin1',
  );
}

/** Hoje no fuso da instituicao, pedido ao PostgreSQL — como o backend faz. */
async function dataLocalDaInstituicao() {
  const cliente = await conectarAoBanco();

  try {
    const { rows } = await cliente.query('SELECT (now() AT TIME ZONE $1)::date::text AS hoje', [TZ]);
    return rows[0].hoje;
  } finally {
    await cliente.end();
  }
}

function somarDias(data, dias) {
  const [ano, mes, dia] = data.split('-').map(Number);
  const instante = new Date(Date.UTC(ano, mes - 1, dia));

  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

async function matriculaDe(usuarioId) {
  const cliente = await conectarAoBanco();

  try {
    const { rows } = await cliente.query('SELECT matricula FROM alunos WHERE usuario_id = $1', [
      usuarioId,
    ]);
    return rows[0].matricula;
  } finally {
    await cliente.end();
  }
}

/** A prova de que a inscricao publica nao fabricou identidade. */
async function contarIdentidades(email, matricula) {
  const cliente = await conectarAoBanco();

  try {
    const usuarios = await cliente.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
    const alunos = await cliente.query('SELECT 1 FROM alunos WHERE matricula = $1', [matricula]);

    return { usuarios: usuarios.rowCount, alunos: alunos.rowCount };
  } finally {
    await cliente.end();
  }
}

/**
 * Tenta escrever na media por SQL direto.
 *
 * A validacao do DTO so cobre quem passa pela API. Esta tentativa e o que
 * prova a afirmacao forte: a media nao e sobrescrevivel por NINGUEM, porque e
 * coluna GENERATED ALWAYS no PostgreSQL.
 */
async function tentarSobrescreverMedia(inscricaoId) {
  const cliente = await conectarAoBanco();

  try {
    await cliente.query('UPDATE inscricoes_edital SET media = 10 WHERE id = $1', [inscricaoId]);
    return null;
  } catch (erro) {
    return erro.message;
  } finally {
    await cliente.end();
  }
}

async function editalAindaNoBanco(editalId) {
  const cliente = await conectarAoBanco();

  try {
    const { rows } = await cliente.query('SELECT ativo FROM editais WHERE id = $1', [editalId]);
    return rows[0] ?? null;
  } finally {
    await cliente.end();
  }
}

/** Le, direto do banco, o que a aprovacao gravou nas tres tabelas. */
async function conferirAprovacao(aprovacao, editalId) {
  const cliente = await conectarAoBanco();

  try {
    const { rows: monitorias } = await cliente.query(
      'SELECT edital_id, professor_id FROM monitorias WHERE id = $1',
      [aprovacao.monitoria.id],
    );

    const { rows: vinculos } = await cliente.query(
      `SELECT papel, status, habilitado_por_usuario_id AS habilitado_por
         FROM monitoria_participantes
        WHERE monitoria_id = $1 AND aluno_id = $2`,
      [aprovacao.monitoria.id, aprovacao.monitor.usuarioId],
    );

    const { rows: contas } = await cliente.query(
      `SELECT u.email, a.matricula, a.curso_id
         FROM usuarios u JOIN alunos a ON a.usuario_id = u.id
        WHERE u.id = $1`,
      [aprovacao.monitor.usuarioId],
    );

    void editalId;

    return {
      editalDaMonitoria: monitorias[0]?.edital_id,
      professorDaMonitoria: monitorias[0]?.professor_id,
      vinculo: vinculos[0] ?? null,
      contaDoCandidato: contas[0] ?? null,
    };
  } finally {
    await cliente.end();
  }
}

/** A prova de que reaproveitar a conta nao cria identidade nova. */
async function contarUsuarios() {
  const cliente = await conectarAoBanco();

  try {
    const { rows } = await cliente.query('SELECT count(*)::int AS total FROM usuarios');
    return rows[0].total;
  } finally {
    await cliente.end();
  }
}

main().catch((erro) => {
  console.error(`\n${vermelho('ERRO FATAL')} ${erro.message}\n`);
  process.exit(1);
});
