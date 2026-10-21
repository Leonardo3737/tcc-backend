/**
 * Verificacao SOMENTE LEITURA da carga horaria e do relatorio, contra o banco
 * real. Nao escreve nada: nenhuma linha e criada, alterada ou apagada.
 *
 * Duas coisas que nem o teste de unidade nem o fluxo offline provam:
 *
 *  1. a carga horaria que a API devolve e igual a soma independente feita por
 *     SQL sobre os atendimentos REALIZADOS — conferida monitor por monitor;
 *  2. o relatorio gera, abre e sai preenchido com os dados que estao no banco
 *     AGORA, passando pelas tres consultas reais do service.
 *
 *   npm run build && node scripts/ver-relatorio-no-banco.cjs [saida.docx]
 */
require('reflect-metadata');

const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { Client } = require('pg');

require('dotenv').config({ quiet: true });

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { AnalyticsService } = require('../dist/modules/analytics/analytics.service');
const {
  RelatorioMonitoriaService,
} = require('../dist/modules/relatorios/relatorio-monitoria.service');
const { abrirDocx } = require('../dist/modules/relatorios/docx/pacote-docx');

/** Fica na raiz do backend (ignorada pelo git), nao fora do projeto. */
const SAIDA = process.argv[2] ?? join(__dirname, '..', 'relatorio-do-banco.docx');

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const vermelho = (t) => `\x1b[31m${t}\x1b[0m`;
const cinza = (t) => `\x1b[90m${t}\x1b[0m`;

let falhas = 0;

function ok(texto, detalhe = '') {
  console.log(`${verde('  OK  ')} ${texto} ${detalhe ? cinza(detalhe) : ''}`);
}

function falhou(texto, detalhe = '') {
  falhas += 1;
  console.log(`${vermelho(' FALHA')} ${texto} ${detalhe ? cinza(detalhe) : ''}`);
}

async function conectar() {
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

function textoDoDocumento(xml) {
  const decodificar = (t) =>
    t
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');

  const paragrafos = (xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []).map((bloco) =>
    decodificar(
      (bloco.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join(''),
    ),
  );

  const linhas = (xml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? []).map((tr) =>
    (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((tc) =>
      (tc.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join(''),
    ),
  );

  return { paragrafos, linhas };
}

(async () => {
  const contexto = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const analytics = contexto.get(AnalyticsService);
  const relatorios = contexto.get(RelatorioMonitoriaService);
  const cliente = await conectar();

  try {
    /** ------------------------------------------- 1. carga horaria */

    console.log('\n\x1b[1mCarga horaria: API contra soma independente no banco\x1b[0m');

    const { rows: vinculos } = await cliente.query(`
      SELECT mp.id AS participante_id, mp.monitoria_id, u.nome AS monitor,
             (SELECT count(*) FROM atendimentos a
               WHERE a.monitor_participante_id = mp.id)::int AS atendimentos,
             (SELECT count(*) FROM atendimentos a
               WHERE a.monitor_participante_id = mp.id AND a.status = 'REALIZADO')::int AS realizados,
             COALESCE((
               SELECT ROUND(SUM(EXTRACT(EPOCH FROM (a.fim - a.inicio))) / 60)
                 FROM atendimentos a
                WHERE a.monitor_participante_id = mp.id AND a.status = 'REALIZADO'
             ), 0)::int AS minutos_no_banco
        FROM monitoria_participantes mp
        JOIN usuarios u ON u.id = mp.aluno_id
       WHERE mp.papel = 'MONITOR' AND mp.status = 'ATIVO'
       ORDER BY realizados DESC, atendimentos DESC`);

    if (vinculos.length === 0) {
      falhou('Nenhum vinculo ATIVO de monitor no banco — nada a conferir');
    }

    const porMonitoria = new Map();

    for (const vinculo of vinculos) {
      if (!porMonitoria.has(vinculo.monitoria_id)) {
        porMonitoria.set(vinculo.monitoria_id, await analytics.monitores(vinculo.monitoria_id));
      }

      const daApi = porMonitoria
        .get(vinculo.monitoria_id)
        .find((m) => m.participanteId === vinculo.participante_id);

      const rotulo =
        `${vinculo.monitor} (${vinculo.atendimentos} atendimento(s), ` +
        `${vinculo.realizados} realizado(s))`;

      if (daApi?.cargaHorariaMinutos === vinculo.minutos_no_banco) {
        ok(`${rotulo}: ${vinculo.minutos_no_banco} min`, `horas=${daApi.cargaHorariaHoras}`);
      } else {
        falhou(
          `${rotulo}: API ${daApi?.cargaHorariaMinutos} != banco ${vinculo.minutos_no_banco}`,
        );
      }

      if (
        daApi &&
        daApi.cargaHorariaHoras !== Math.round((daApi.cargaHorariaMinutos / 60) * 100) / 100
      ) {
        falhou(`${rotulo}: horas e minutos discordam`);
      }
    }

    /**
     * O caso que prova o recorte: monitor com atendimentos mas nenhum
     * REALIZADO tem de somar ZERO. Se AGENDADO ou CANCELADO entrassem, este
     * seria o unico lugar onde apareceria.
     */
    const semRealizados = vinculos.filter((v) => v.atendimentos > 0 && v.realizados === 0);

    if (semRealizados.length > 0) {
      const todosZero = semRealizados.every((v) => v.minutos_no_banco === 0);
      const apiZero = semRealizados.every(
        (v) =>
          porMonitoria
            .get(v.monitoria_id)
            .find((m) => m.participanteId === v.participante_id)?.cargaHorariaMinutos === 0,
      );

      if (todosZero && apiZero) {
        ok(
          'Atendimento AGENDADO/CANCELADO nao conta carga horaria',
          `${semRealizados.length} monitor(es) com atendimento e 0 min`,
        );
      } else {
        falhou('Atendimento nao realizado entrou na carga horaria');
      }
    } else {
      console.log(cinza('  (sem monitor com atendimento nao realizado para conferir o recorte)'));
    }

    /** ------------------------------------------- 2. relatorio */

    console.log('\n\x1b[1mRelatorio .docx gerado a partir do banco\x1b[0m');

    const alvo = vinculos[0];

    if (!alvo) {
      falhou('Sem vinculo para gerar relatorio');
      return;
    }

    const { conteudo, nomeDoArquivo } = await relatorios.gerar({
      monitoria: { id: alvo.monitoria_id },
      participacao: { id: alvo.participante_id },
      ehProfessorResponsavel: false,
      papel: 'MONITOR',
    });

    await writeFile(SAIDA, conteudo);

    const { pacote, documentoXml } = await abrirDocx(conteudo);
    const { paragrafos, linhas } = textoDoDocumento(documentoXml);

    ok('Documento gerado', `${conteudo.length} bytes | ${nomeDoArquivo}`);
    ok('Pacote legivel', `${Object.keys(pacote.files).length} entradas`);

    const identificacao = paragrafos.filter((p) =>
      /^(CURSO|DISCIPLINA|PER[ÍI]ODO|PROFESSOR-ORIENTADOR\(A\)|MONITOR\(A\)|MATR[ÍI]CULA|EMAIL|TURNO|TELEFONE|QUANTIDADE|TITULA|DIAS)/.test(
        p,
      ),
    );

    console.log(cinza('\n  --- identificacao no documento ---'));
    identificacao.forEach((p) => console.log(cinza(`  ${p}`)));

    const preenchidos = ['CURSO: ', 'DISCIPLINA:', 'MONITOR(A): ', 'EMAIL: '];
    const vazios = preenchidos.filter((rotulo) =>
      paragrafos.every((p) => !p.startsWith(rotulo) || p.trim() === rotulo.trim()),
    );

    if (vazios.length === 0) {
      ok('Campos com dado no banco foram preenchidos');
    } else {
      falhou('Campo que deveria ser preenchido saiu vazio', vazios.join(' | '));
    }

    const emBranco = ['TURNO:', 'TELEFONE: ', 'QUANTIDADE DE ALUNOS NA TURMA:'];
    const indevidos = emBranco.filter((rotulo) => !paragrafos.includes(rotulo));

    if (indevidos.length === 0) {
      ok('Campos sem dado no sistema ficaram em branco', emBranco.join(' | '));
    } else {
      falhou('Campo preenchido com palpite', indevidos.join(' | '));
    }

    if (!documentoXml.includes('Farmacologia da Esquizofrenia')) {
      ok('Linhas de exemplo do modelo removidas');
    } else {
      falhou('Dados de exemplo do modelo vazaram para o relatorio');
    }

    const vazias = linhas.filter((l) => l.every((c) => !c)).length;

    if (vazias >= 5) {
      ok('Linhas em branco para preenchimento manual', `${vazias} de ${linhas.length}`);
    } else {
      falhou(`Poucas linhas em branco: ${vazias}`);
    }

    console.log(cinza(`\n  --- tabela (${linhas.length} linhas) ---`));
    linhas.slice(0, 6).forEach((l, i) => console.log(cinza(`  [${i}] ${JSON.stringify(l)}`)));

    console.log(`\nArquivo salvo em ${SAIDA}`);
  } finally {
    await cliente.end();
    await contexto.close();
  }

  console.log(
    `\n${falhas === 0 ? verde('TUDO CONFERIDO') : vermelho(`${falhas} FALHA(S)`)}\n`,
  );

  process.exit(falhas === 0 ? 0 : 1);
})();
