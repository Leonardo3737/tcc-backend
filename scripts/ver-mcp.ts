/**
 * Verificacao do servidor MCP contra a aplicacao REAL.
 *
 * Sobe o AppModule inteiro, assina um token para um professor e outro para um
 * aluno existentes no banco e conversa com `/mcp` como um cliente de verdade.
 * E a unica forma de provar tres coisas que a metadata sozinha nao prova:
 *
 *   1. `@ToolRoles` realmente RECORTA o que cada perfil enxerga em `tools/list`
 *      — a metadata so diz o que foi declarado, nao o que a biblioteca faz com
 *      isso;
 *   2. uma ferramenta de leitura responde de ponta a ponta (dispatch, pipe de
 *      validacao, service, filtro de excecao);
 *   3. o schema fechado RECUSA campo inventado e, em particular, recusa
 *      `professorId` em `criar_monitoria` — o campo que o servidor preenche.
 *
 * Nao escreve nada no banco: as duas chamadas de escrita que faz sao
 * propositalmente invalidas e precisam ser recusadas antes de chegar ao INSERT.
 *
 *   PORT=3999 npm run ver-mcp
 */
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';

import { AppModule } from '../src/app.module';
import { mcp } from '../src/mcp/mcp.strategy';

const PORTA = Number(process.env.PORT ?? 3999);
const PREFIXO = process.env.API_PREFIXO ?? 'api';

const verde = (t: string) => `\x1b[32m${t}\x1b[0m`;
const vermelho = (t: string) => `\x1b[31m${t}\x1b[0m`;
const cinza = (t: string) => `\x1b[90m${t}\x1b[0m`;

/**
 * O transporte streamable-http responde em SSE quando o cliente aceita
 * `text/event-stream`, entao o JSON vem depois de `data: `.
 */
async function jsonRpc(token: string, corpo: unknown): Promise<Record<string, any>> {
  const resposta = await fetch(`http://localhost:${PORTA}/${PREFIXO}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(corpo),
  });

  const texto = await resposta.text();

  if (!resposta.ok) {
    throw new Error(`/mcp respondeu ${resposta.status}: ${texto.slice(0, 300)}`);
  }

  const marcador = 'data: ';
  const bruto = texto.startsWith('event:')
    ? texto.slice(texto.indexOf(marcador) + marcador.length).split(/\r?\n/)[0]
    : texto;

  return JSON.parse(bruto);
}

async function listarFerramentas(token: string): Promise<string[]> {
  const json = await jsonRpc(token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

  if (json.error) throw new Error(`tools/list devolveu erro: ${JSON.stringify(json.error)}`);

  return (json.result?.tools ?? []).map((t: { name: string }) => t.name).sort();
}

async function chamar(
  token: string,
  nome: string,
  argumentos: Record<string, unknown>,
): Promise<{ erro: boolean; texto: string }> {
  const json = await jsonRpc(token, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: nome, arguments: argumentos },
  });

  if (json.error) return { erro: true, texto: JSON.stringify(json.error) };

  return {
    erro: Boolean(json.result?.isError),
    texto: (json.result?.content ?? []).map((c: { text?: string }) => c.text ?? '').join(''),
  };
}

/** Ferramentas que um ALUNO nunca pode enxergar. */
const SO_DE_PROFESSOR = [
  'criar_aluno',
  'listar_alunos',
  'criar_professor',
  'criar_curso',
  'criar_disciplina',
  'criar_edital',
  'listar_editais',
  'listar_inscricoes',
  'detalhar_inscricao',
  'exportar_inscricoes',
  'obter_boletim_da_inscricao',
  'aprovar_inscricao',
  'criar_monitoria',
  'habilitar_monitor',
  'inscrever_monitorado',
  'promover_participante_a_monitor',
  'indicadores_da_plataforma',
  'atividade_dos_monitores',
];

let falhas = 0;
const ok = (t: string, d = '') => console.log(`${verde('  OK  ')} ${t} ${d ? cinza(d) : ''}`);
const falhou = (t: string, d = '') => {
  falhas += 1;
  console.log(`${vermelho(' FALHA')} ${t} ${d ? cinza(d) : ''}`);
};

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix(PREFIXO);
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp } as never);
  await app.startAllMicroservices();
  await app.listen(PORTA);

  try {
    const sequelize = app.get<Sequelize>(getConnectionToken());
    const jwt = app.get(JwtService);

    const [professor] = await sequelize.query<{ id: string; email: string }>(
      `SELECT u.id, u.email FROM usuarios u JOIN professores p ON p.usuario_id = u.id LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    const [aluno] = await sequelize.query<{ id: string; email: string }>(
      `SELECT u.id, u.email FROM usuarios u JOIN alunos a ON a.usuario_id = u.id
        WHERE NOT EXISTS (SELECT 1 FROM professores p WHERE p.usuario_id = u.id) LIMIT 1`,
      { type: QueryTypes.SELECT },
    );

    if (!professor) {
      falhou('Banco sem professor: rode `npm run db:seed` antes.');
      return;
    }

    const tokenProf = await jwt.signAsync({
      sub: professor.id,
      email: professor.email,
      perfis: ['PROFESSOR'],
    });

    console.log('\n\x1b[1mtools/list\x1b[0m');
    const doProfessor = await listarFerramentas(tokenProf);
    ok(`PROFESSOR enxerga ${doProfessor.length} ferramentas`);

    if (aluno) {
      const tokenAluno = await jwt.signAsync({
        sub: aluno.id,
        email: aluno.email,
        perfis: ['ALUNO'],
      });

      const doAluno = await listarFerramentas(tokenAluno);
      ok(`ALUNO enxerga ${doAluno.length} ferramentas`);

      const soProfessor = doProfessor.filter((t) => !doAluno.includes(t));
      const soAluno = doAluno.filter((t) => !doProfessor.includes(t));
      console.log(cinza(`\n  so PROFESSOR (${soProfessor.length}): ${soProfessor.join(', ')}`));
      console.log(cinza(`  so ALUNO (${soAluno.length}): ${soAluno.join(', ')}\n`));

      const vazamento = doAluno.filter((t) => SO_DE_PROFESSOR.includes(t));

      if (vazamento.length === 0) {
        ok('Nenhuma ferramenta de PROFESSOR aparece para o ALUNO');
      } else {
        falhou('VAZAMENTO: aluno enxerga ferramenta de professor', vazamento.join(', '));
      }
    } else {
      console.log(cinza('  (banco sem aluno puro: o recorte do ALUNO nao foi exercitado)'));
    }

    console.log('\n\x1b[1mtools/call\x1b[0m');

    const leitura = await chamar(tokenProf, 'listar_cursos', { limite: 1 });
    if (leitura.erro) {
      falhou('listar_cursos', leitura.texto.slice(0, 200));
    } else {
      ok('listar_cursos respondeu de ponta a ponta', leitura.texto.slice(0, 120));
    }

    /* Campo inventado: `additionalProperties: false` + whitelist precisam RECUSAR. */
    const invalida = await chamar(tokenProf, 'listar_cursos', { campoInexistente: 1 });
    if (invalida.erro) {
      ok('Campo fora do DTO e recusado', invalida.texto.slice(0, 120));
    } else {
      falhou('A ferramenta ACEITOU um campo que nao existe no DTO');
    }

    /* `professorId` e preenchido pelo servidor: mandar de fora tem de ser recusado. */
    const massAssignment = await chamar(tokenProf, 'criar_monitoria', {
      disciplinaId: '11111111-1111-4111-8111-111111111111',
      professorId: '22222222-2222-4222-8222-222222222222',
      ano: 2026,
      semestre: 2,
    });
    if (massAssignment.erro) {
      ok('professorId vindo do cliente e recusado', massAssignment.texto.slice(0, 120));
    } else {
      falhou('A ferramenta ACEITOU professorId vindo do cliente');
    }
  } finally {
    await app.close();
  }

  console.log(`\n${falhas === 0 ? verde('TUDO CONFERIDO') : vermelho(`${falhas} FALHA(S)`)}\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(vermelho(`FALHOU: ${e?.message ?? e}`));
  process.exit(1);
});
