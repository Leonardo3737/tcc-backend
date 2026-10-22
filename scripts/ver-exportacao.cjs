/**
 * Verificacao SOMENTE LEITURA da exportacao em .xlsx, contra o banco real.
 *
 * Gera a planilha de cada edital que tem inscricao, LE o arquivo de volta e
 * compara linha por linha com uma consulta independente — e o unico jeito de
 * afirmar que o recorte da planilha e o mesmo do banco e que as notas chegaram
 * ao Excel como numero.
 *
 *   npm run build && node scripts/ver-exportacao.cjs [saida.xlsx]
 */
require('reflect-metadata');

const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { Client } = require('pg');
const JSZip = require('jszip');

require('dotenv').config({ quiet: true });

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const {
  InscricoesEditalService,
} = require('../dist/modules/editais/inscricoes-edital.service');
const { colunasDaPlanilha } = require('../dist/modules/editais/planilha-de-inscricoes');

/** Fica na raiz do backend (ignorada pelo git), nao fora do projeto. */
const SAIDA = process.argv[2] ?? join(__dirname, '..', 'inscricoes-exportadas.xlsx');

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const vermelho = (t) => `\x1b[31m${t}\x1b[0m`;
const cinza = (t) => `\x1b[90m${t}\x1b[0m`;

let falhas = 0;
const ok = (t, d = '') => console.log(`${verde('  OK  ')} ${t} ${d ? cinza(d) : ''}`);
const falhou = (t, d = '') => {
  falhas += 1;
  console.log(`${vermelho(' FALHA')} ${t} ${d ? cinza(d) : ''}`);
};

/** Le celulas, tipos e valores do `sheet1.xml`. Ver o spec para o porque. */
async function lerPlanilha(bytes) {
  const pacote = await JSZip.loadAsync(bytes);
  const folha = await pacote.file('xl/worksheets/sheet1.xml').async('string');
  const arquivoDeTextos = pacote.file('xl/sharedStrings.xml');
  const compartilhadas = arquivoDeTextos ? await arquivoDeTextos.async('string') : '';

  const textos = [...compartilhadas.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) =>
    m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  );

  const linhas = [...folha.matchAll(/<row[\s>][\s\S]*?<\/row>/g)].map((linha) =>
    [...linha[0].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((celula) => {
      const valor = /<v>([\s\S]*?)<\/v>/.exec(celula[2] ?? '')?.[1] ?? null;
      const ehTexto = /t="s"/.test(celula[1]);

      return {
        tipo: ehTexto ? 'texto' : valor === null ? 'vazia' : 'numero',
        valor: valor === null ? null : ehTexto ? textos[Number(valor)] : Number(valor),
      };
    }),
  );

  return { linhas, entradas: Object.keys(pacote.files).length };
}

(async () => {
  const contexto = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const inscricoes = contexto.get(InscricoesEditalService);

  const cliente = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await cliente.connect();

  try {
    const { rows: editais } = await cliente.query(`
      SELECT e.id, e.ano, e.semestre, count(i.id)::int AS inscricoes
        FROM editais e
        JOIN inscricoes_edital i ON i.edital_id = e.id
       GROUP BY e.id, e.ano, e.semestre
       ORDER BY inscricoes DESC`);

    if (editais.length === 0) {
      falhou('Nenhum edital com inscricao no banco — nada a exportar');
      return;
    }

    for (const edital of editais) {
      console.log(
        `\n\x1b[1mEdital ${edital.ano}/${edital.semestre} — ${edital.inscricoes} inscricao(oes)\x1b[0m`,
      );

      const { conteudo, nomeDoArquivo, total } = await inscricoes.exportar({
        editalId: edital.id,
        ordenarPor: 'media',
        direcao: 'desc',
      });

      const { linhas, entradas } = await lerPlanilha(conteudo);

      if (total === edital.inscricoes && linhas.length === edital.inscricoes + 1) {
        ok(`${total} linha(s) + cabecalho`, `${nomeDoArquivo} | ${entradas} entradas no pacote`);
      } else {
        falhou(
          `Contagem divergente: planilha ${linhas.length - 1}, banco ${edital.inscricoes}`,
        );
      }

      const titulos = linhas[0].map((c) => c.valor);

      if (JSON.stringify(titulos) === JSON.stringify(colunasDaPlanilha())) {
        ok('Cabecalho com as 10 colunas na ordem combinada');
      } else {
        falhou('Cabecalho inesperado', JSON.stringify(titulos));
      }

      /** Consulta independente, para comparar o conteudo celula a celula. */
      const { rows: esperadas } = await cliente.query(
        `SELECT i.email, i.nome_completo, i.matricula, c.nome AS curso, d.nome AS disciplina,
                up.nome AS professor, i.turno, i.n1, i.n2, i.media
           FROM inscricoes_edital i
           JOIN cursos c ON c.id = i.curso_id
           JOIN disciplinas d ON d.id = i.disciplina_id
           JOIN professores pr ON pr.usuario_id = i.professor_id
           JOIN usuarios up ON up.id = pr.usuario_id
          WHERE i.edital_id = $1
          ORDER BY i.media DESC NULLS LAST, i.id ASC`,
        [edital.id],
      );

      let divergencias = 0;

      esperadas.forEach((esperada, indice) => {
        const linha = linhas[indice + 1];
        const doBanco = [
          esperada.email,
          esperada.nome_completo,
          esperada.matricula,
          esperada.curso,
          esperada.disciplina,
          esperada.professor,
          esperada.turno,
          esperada.n1 === null ? null : Number(esperada.n1),
          esperada.n2 === null ? null : Number(esperada.n2),
          esperada.media === null ? null : Number(esperada.media),
        ];

        doBanco.forEach((valor, coluna) => {
          if ((linha[coluna]?.valor ?? null) !== valor) {
            divergencias += 1;
            falhou(
              `Linha ${indice + 1}, ${colunasDaPlanilha()[coluna]}`,
              `planilha=${JSON.stringify(linha[coluna]?.valor)} banco=${JSON.stringify(valor)}`,
            );
          }
        });
      });

      if (divergencias === 0) {
        ok('Todas as celulas batem com a consulta independente');
      }

      const tipos = linhas.slice(1).map((l) => l.slice(7).map((c) => c.tipo));
      const notasTextuais = tipos.flat().filter((t) => t === 'texto').length;

      if (notasTextuais === 0) {
        ok('Notas e media sao numero na planilha, nunca texto');
      } else {
        falhou(`${notasTextuais} celula(s) de nota gravada(s) como texto`);
      }

      const zerosIndevidos = esperadas.reduce((conta, esperada, indice) => {
        const linha = linhas[indice + 1];
        const nulos = [esperada.n1, esperada.n2, esperada.media];

        return (
          conta +
          nulos.filter((valor, coluna) => valor === null && linha[7 + coluna]?.valor === 0).length
        );
      }, 0);

      if (zerosIndevidos === 0) {
        ok('Nota ausente ficou como celula VAZIA, nunca zero');
      } else {
        falhou(`${zerosIndevidos} nota ausente virou zero`);
      }

      await writeFile(SAIDA, conteudo);

      console.log(cinza(`\n  --- primeiras linhas ---`));
      linhas.slice(0, 4).forEach((l, i) =>
        console.log(cinza(`  [${i}] ${JSON.stringify(l.map((c) => c.valor))}`)),
      );
    }

    console.log(`\nUltima planilha salva em ${SAIDA}`);
  } finally {
    await cliente.end();
    await contexto.close();
  }

  console.log(`\n${falhas === 0 ? verde('TUDO CONFERIDO') : vermelho(`${falhas} FALHA(S)`)}\n`);
  process.exit(falhas === 0 ? 0 : 1);
})();
