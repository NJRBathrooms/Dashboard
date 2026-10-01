// Garante que obra encerrada não apareça para o funcionário nem aceite horas.
//
// O defeito original (out/2026): a lista do app de horas era montada com TODAS as
// obras, sem olhar a coluna "Finalizada", e ainda era reforçada pelo histórico de
// labor — então uma obra fechada voltava para a lista pela porta dos fundos, já
// que o pessoal tinha lançado horas nela. Resultado em produção: 18 registros
// caíram em obras já encerradas, 9 deles em "190 Pine Street, Holbrook - MA"
// depois de 17/09/2026.
//
// Rodar: node scripts/test-emp-obra-fechada.js
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

// ── planilha simulada, com os cabeçalhos reais da produção ──
const HEADERS = ['Endereço', 'Nome do Cliente', 'Contato', 'Escopo', 'Orçamento',
  'Data Início Prevista', 'Data Fim Prevista', 'Link Fotos Antes', 'Finalizada',
  'Data Finalização', 'Link Fotos Depois'];
const L_HEADERS = ['Carimbo de data/hora', 'Nome do funcionário', 'Endereço da obra',
  'Hora de entrada', 'Hora de saída', 'Horas trabalhadas', 'Comprou materiais hoje?',
  'Valor total gasto', 'Quem pagou?', 'Foto do recibo', 'Material necessário', 'Observações'];

const SHEET_OBRAS = [HEADERS.slice(),
  ['190 Pine Street, Holbrook - MA',       'Juliana Stein', '', '', 5800, '', '', '', 'Sim', '2026-09-17', ''],
  ['190 Pine Street, Holbrook - MA 02343', 'Juliana Stein', '', '', 6500, '', '', '', 'Não', '', ''],
  ['256 Pine St Rehoboth, MA',             'Jimmy',         '', '', 8700, '', '', '', '',    '', ''],
];
let LABOR_ROWS = [];

// O mock entra no cache ANTES de carregar os módulos da api: _google.js importa
// googleapis, que não existe fora da Vercel.
const gpath = path.join(ROOT, 'api', '_google.js');
require.cache[require.resolve(gpath)] = { id: gpath, filename: gpath, loaded: true, exports: {
  normStr: s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '),
  loadSheetIndex: async () => ({ tz: 'America/New_York', index: [
    { title: 'Cadastro de Obras', sheetId: 1, headers: HEADERS },
    { title: 'Registro de Trabalho', sheetId: 2, headers: L_HEADERS },
  ] }),
  findSheetEntry: (index, kws) => index.find(s => kws.every(k => s.headers.some(h => h.toLowerCase().includes(k)))) || null,
  readColumn: async (title, i) => (title === 'Cadastro de Obras' ? SHEET_OBRAS : [L_HEADERS]).map(r => r[i]),
  buildRow: (headers, mapping) => {
    const row = new Array(headers.length).fill('');
    for (const m of mapping) {
      if (m.val === undefined) continue;
      const i = m.fuzzy ? headers.findIndex(h => h.toLowerCase().includes(m.key.toLowerCase())) : headers.indexOf(m.key);
      if (i >= 0) row[i] = m.val;
    }
    return row;
  },
  appendRow: async (t, row) => { LABOR_ROWS.push(row); },
  updateRowCells: async () => {},
  deleteRow: async () => {},
  createSheet: async () => {},
  nowInTz: () => '2026-10-01 10:00:00',
  nowFriendly: () => '01/10/2026 10:00',
  sendEmail: async () => {},
} };

const { enderecosDisponiveis } = require(path.join(ROOT, 'api', 'emp-data.js'));
const { addLabor } = require(path.join(ROOT, 'api', '_actions.js'));

let fails = 0;
const teste = (nome, fn) => {
  try { fn(); console.log('  ok  ' + nome); }
  catch (e) { fails++; console.log('  FALHOU  ' + nome + '\n          ' + e.message); }
};
const testeAsync = async (nome, fn) => {
  try { await fn(); console.log('  ok  ' + nome); }
  catch (e) { fails++; console.log('  FALHOU  ' + nome + '\n          ' + e.message); }
};

// ── 1. a lista de endereços que o app de funcionário recebe ──
const OBRAS = [
  { 'Endereço': '190 Pine Street, Holbrook - MA',       'Finalizada': 'Sim' },
  { 'Endereço': '190 Pine Street, Holbrook - MA 02343', 'Finalizada': 'Não' },
  { 'Endereço': '256 Pine St Rehoboth, MA',             'Finalizada': '' },
  { 'Endereço': '  4 Tara rd, Essex  ',                 'Finalizada': 'sim' },
];
const LABOR = [
  // o pessoal lançou horas na obra fechada — não pode trazê-la de volta
  { 'Endereço da obra': '190 Pine Street, Holbrook - MA' },
  { 'Endereço da obra': '190  Pine  Street,  Holbrook - MA' },  // espaçamento diferente
  { 'Endereço da obra': '4 Tara rd, Essex' },
  { 'Endereço da obra': '50 Tobey St Providence' },             // legada, sem ficha de obra
  { 'Endereço da obra': '' },
];
const lista = enderecosDisponiveis(OBRAS, LABOR);

teste('obra finalizada não entra na lista', () =>
  assert.ok(!lista.includes('190 Pine Street, Holbrook - MA'), 'obra fechada apareceu: ' + JSON.stringify(lista)));

teste('obra finalizada não volta pelo histórico de horas', () =>
  assert.ok(!lista.some(a => a.includes('190  Pine')), 'variante com espaços extras vazou'));

teste('"Finalizada" minúsculo também vale', () =>
  assert.ok(!lista.some(a => a.includes('Tara')), '4 Tara rd deveria estar fora'));

teste('obra aberta de endereço parecido continua na lista', () =>
  assert.ok(lista.includes('190 Pine Street, Holbrook - MA 02343'),
    'o filtro casou por prefixo e derrubou a obra aberta'));

teste('"Finalizada" vazio conta como aberta', () =>
  assert.ok(lista.includes('256 Pine St Rehoboth, MA'), 'obra sem marca sumiu'));

teste('obra legada (só no labor) continua disponível', () =>
  assert.ok(lista.includes('50 Tobey St Providence'), 'obra legada sumiu'));

teste('endereço vazio não entra', () =>
  assert.ok(!lista.includes(''), 'entrou string vazia'));

teste('lista vem ordenada e sem repetição', () =>
  assert.deepStrictEqual(lista, [...new Set(lista)].sort(), 'lista com repetição ou fora de ordem'));

teste('sem obras nem labor devolve lista vazia', () =>
  assert.deepStrictEqual(enderecosDisponiveis(null, null), []));

// ── 2. a trava do servidor em addLabor ─────────────────────
const lancar = addr => { LABOR_ROWS = []; return addLabor({ emp: 'Edelson de Oliveira', addr, entryTime: '08:00', exitTime: '17:00', hrs: 8 }); };

(async () => {
  await testeAsync('addLabor recusa obra encerrada', async () => {
    const r = await lancar('190 Pine Street, Holbrook - MA');
    assert.ok(r.error, 'deveria ter devolvido erro');
    assert.match(r.error, /encerrada/i);
    assert.strictEqual(LABOR_ROWS.length, 0, 'não podia ter gravado linha');
  });

  await testeAsync('a recusa não depende de maiúsculas nem de espaços', async () => {
    const r = await lancar('  190  pine  street,  holbrook - ma ');
    assert.ok(r.error, 'variante escapou da trava');
    assert.strictEqual(LABOR_ROWS.length, 0);
  });

  await testeAsync('addLabor aceita a obra aberta de endereço parecido', async () => {
    const r = await lancar('190 Pine Street, Holbrook - MA 02343');
    assert.ok(!r.error, 'erro inesperado: ' + r.error);
    assert.strictEqual(LABOR_ROWS.length, 1, 'não gravou');
    assert.strictEqual(LABOR_ROWS[0][L_HEADERS.indexOf('Endereço da obra')], '190 Pine Street, Holbrook - MA 02343');
  });

  await testeAsync('"Finalizada" vazio não bloqueia', async () => {
    const r = await lancar('256 Pine St Rehoboth, MA');
    assert.ok(!r.error, 'erro inesperado: ' + r.error);
    assert.strictEqual(LABOR_ROWS.length, 1);
  });

  await testeAsync('obra legada (sem ficha) continua aceitando horas', async () => {
    const r = await lancar('50 Tobey St Providence');
    assert.ok(!r.error, 'erro inesperado: ' + r.error);
    assert.strictEqual(LABOR_ROWS.length, 1);
  });

  await testeAsync('nome do funcionário continua obrigatório', async () => {
    LABOR_ROWS = [];
    const r = await addLabor({ emp: '', addr: '256 Pine St Rehoboth, MA' });
    assert.ok(r.error, 'deveria exigir o funcionário');
    assert.strictEqual(LABOR_ROWS.length, 0);
  });

  console.log(fails ? '\n' + fails + ' falha(s).' : '\nobra fechada ok.');
  process.exit(fails ? 1 : 0);
})();
