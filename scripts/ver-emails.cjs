/**
 * Imprime TODO texto de e-mail que a aplicacao envia, ja renderizado.
 *
 * Revisar as strings no codigo nao basta: o que a pessoa le e o resultado da
 * montagem — ramificacoes de singular/plural, blocos opcionais e linhas que se
 * juntam. Este script existe para conferir a forma final, de olho.
 *
 * Le o build (`dist/`), nao o fonte: exige `npm run build` antes.
 *
 *   npm run build && node scripts/ver-emails.cjs
 */
const { MENSAGENS } = require('../dist/modules/notificacoes/mensagens');
const { montarConfirmacao } = require('../dist/modules/editais/mensagem-de-confirmacao');

const FUSO = 'America/Porto_Velho';

const dados = {
  disciplina: 'Cálculo Diferencial e Integral I',
  inicio: new Date('2026-10-20T17:00:00Z'),
  fim: new Date('2026-10-20T18:00:00Z'),
  modalidade: 'PRESENCIAL',
  local: 'Sala 203, bloco B',
  monitor: 'Ana Monitora',
};

const base = { nome: 'João Pedro', dados, fuso: FUSO, link: 'https://sistema/x' };

const casos = [
  ['LEMBRETE_DIA', 'monitorado', { ...base }],
  ['LEMBRETE_DIA', 'monitor, 3 inscritos', { ...base, papel: 'MONITOR', inscritos: 3 }],
  ['LEMBRETE_DIA', 'monitor, ninguem inscrito', { ...base, papel: 'MONITOR', inscritos: 0 }],
  ['ATENDIMENTO_CANCELADO', 'com motivo', { ...base, motivo: 'Monitor doente' }],
  ['ATENDIMENTO_CANCELADO', 'sem motivo', { ...base }],
  ['ATENDIMENTO_REAGENDADO', '', { ...base }],
  ['ATENDIMENTO_SOLICITADO', '', { ...base }],
  ['ATENDIMENTO_OFERTADO', 'avulso', { ...base }],
  ['ATENDIMENTO_OFERTADO', 'lote, 1 extra', { ...base, demaisSessoes: 1 }],
  ['ATENDIMENTO_OFERTADO', 'lote, 5 extras', { ...base, demaisSessoes: 5 }],
  ['AVALIACAO_PENDENTE', '', { ...base }],
  ['MONITOR_HABILITADO', 'sem inscricao cancelada', { ...base }],
  ['MONITOR_HABILITADO', '1 inscricao cancelada', { ...base, inscricoesCanceladas: 1 }],
  ['MONITOR_HABILITADO', '3 inscricoes canceladas', { ...base, inscricoesCanceladas: 3 }],
];

for (const [tipo, variante, contexto] of casos) {
  const { assunto, corpo } = MENSAGENS[tipo](contexto);

  console.log(`\n${'='.repeat(78)}`);
  console.log(`${tipo}${variante ? ` — ${variante}` : ''}`);
  console.log('-'.repeat(78));
  console.log(`ASSUNTO: ${assunto}\n`);
  console.log(corpo);
}

const confirmacao = montarConfirmacao({
  nomeCompleto: 'Maria Oliveira dos Santos',
  email: 'maria@ufx.edu.br',
  inscricaoId: '3f1c2b9a-0000-4000-8000-000000000000',
  ano: 2026,
  semestre: 2,
  fimInscricoes: '2026-11-25',
  linkDoEdital: 'https://ufx.edu.br/editais/monitoria-2026-2.pdf',
  urlDoSistema: 'https://monitoria.ufx.edu.br',
});

console.log(`\n${'='.repeat(78)}`);
console.log('INSCRICAO EM EDITAL — confirmacao');
console.log('-'.repeat(78));
console.log(`ASSUNTO: ${confirmacao.assunto}\n`);
console.log(confirmacao.texto);
