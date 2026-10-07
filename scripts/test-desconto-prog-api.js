// Ações de servidor dos descontos programados, contra uma planilha simulada.
//
// O que importa aqui: validação (nada entra torto na planilha), marcar/desmarcar
// parcela sem duplicar, e a trava que impede reduzir o plano deixando parcela já
// quitada de fora — o que apagaria histórico de dinheiro descontado.
//
// Rodar: node scripts/test-desconto-prog-api.js
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const HEADERS = ['Carimbo de data/hora', 'Nome do funcionário', 'Descrição', 'Valor Total',
  'Nº de Parcelas', 'Semana de Início', 'Semanas Quitadas', 'Status', 'Observações'];
const C = { TS: 0, EMP: 1, DESC: 2, VAL: 3, N: 4, INI: 5, QUIT: 6, ST: 7, OBS: 8 };

let SHEET, deletadas;
function reset() {
  SHEET = [HEADERS.slice(),
    ['t', 'Leandro Venâncio', 'Conserto do carro', 529, 5, '2026-10-04', '', 'Ativo', ''],   // row 2
    ['t', 'Denys Pifane', 'Adiantamento', 300, 2, '2026-10-11', '2026-10-11', 'Ativo', ''],  // row 3
  ];
  deletadas = [];
}
reset();

const gpath = path.join(ROOT, 'api', '_google.js');
require.cache[require.resolve(gpath)] = { id: gpath, filename: gpath, loaded: true, exports: {
  normStr: s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '),
  loadSheetIndex: async () => ({ tz: 'America/New_York', index: [{ title: 'Descontos Programados', sheetId: 9, headers: HEADERS }] }),
  findSheetEntry: (index, kws) => index.find(s => kws.every(k => s.headers.some(h => h.toLowerCase().includes(k)))) || null,
  createSheet: async () => {},
  nowInTz: () => '2026-10-07 10:00:00',
  nowFriendly: () => '07/10/2026 10:00',
  readColumn: async (t, i) => SHEET.map(r => r[i]),
  buildRow: (headers, mapping) => {
    const row = new Array(headers.length).fill('');
    for (const m of mapping) {
      if (m.val === undefined) continue;
      const i = m.fuzzy ? headers.findIndex(h => h.toLowerCase().includes(m.key.toLowerCase())) : headers.indexOf(m.key);
      if (i >= 0) row[i] = m.val;
    }
    return row;
  },
  appendRow: async (t, row) => { SHEET.push(row); },
  updateRowCells: async (t, rowNum, headers, ups) => {
    ups.forEach(u => { const i = headers.indexOf(u.key); if (i >= 0) SHEET[rowNum - 1][i] = u.val; });
  },
  deleteRow: async (sheetId, rowNum) => { deletadas.push(rowNum); SHEET.splice(rowNum - 1, 1); },
  sendEmail: async () => {},
} };

const A = require(path.join(ROOT, 'api', '_actions.js'));

let fails = 0;
const teste = async (nome, fn) => {
  try { await fn(); console.log('  ok  ' + nome); }
  catch (e) { fails++; console.log('  FALHOU  ' + nome + '\n          ' + e.message); }
};

const base = { emp: 'Ryan Cristian', descricao: 'Ferramenta', valor: 100, parcelas: 4, semanaInicio: '2026-10-04' };

(async () => {
  // ── validação ──
  await teste('recusa funcionário vazio', async () => {
    const r = await A.addDescontoProgramado({ ...base, emp: '  ' });
    assert.match(r.error || '', /funcion/i);
  });
  await teste('recusa motivo vazio', async () => {
    const r = await A.addDescontoProgramado({ ...base, descricao: '' });
    assert.match(r.error || '', /descri/i);
  });
  await teste('recusa valor zero ou negativo', async () => {
    assert.ok((await A.addDescontoProgramado({ ...base, valor: 0 })).error);
    assert.ok((await A.addDescontoProgramado({ ...base, valor: -5 })).error);
  });
  await teste('recusa número de parcelas fora de 1..52', async () => {
    assert.ok((await A.addDescontoProgramado({ ...base, parcelas: 0 })).error);
    assert.ok((await A.addDescontoProgramado({ ...base, parcelas: 53 })).error);
  });
  await teste('recusa semana de início que não é domingo', async () => {
    const r = await A.addDescontoProgramado({ ...base, semanaInicio: '2026-10-07' }); // quarta
    assert.match(r.error || '', /domingo/i);
  });
  await teste('nada inválido chegou a entrar na planilha', async () => {
    assert.strictEqual(SHEET.length, 3, 'planilha deveria continuar com 2 registros');
  });

  // ── criação ──
  await teste('cria o parcelamento e devolve o valor da 1ª parcela', async () => {
    const r = await A.addDescontoProgramado({ ...base, obs: 'serra circular' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.parcela, 25);
    const nova = SHEET[SHEET.length - 1];
    assert.strictEqual(nova[C.EMP], 'Ryan Cristian');
    assert.strictEqual(nova[C.VAL], 100);
    assert.strictEqual(nova[C.N], 4);
    assert.strictEqual(nova[C.INI], '2026-10-04');
    assert.strictEqual(nova[C.ST], 'Ativo');
    assert.strictEqual(nova[C.QUIT], '', 'nasce sem parcela quitada');
  });

  // ── marcar / desmarcar ──
  await teste('marca uma parcela', async () => {
    const r = await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-10-04' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(SHEET[1][C.QUIT], '2026-10-04');
    assert.strictEqual(SHEET[1][C.ST], 'Ativo');
  });
  await teste('marcar duas vezes não duplica', async () => {
    await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-10-04' });
    assert.strictEqual(SHEET[1][C.QUIT], '2026-10-04');
  });
  await teste('marca outra parcela e mantém ordenado', async () => {
    await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-10-18' });
    await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-10-11' });
    assert.strictEqual(SHEET[1][C.QUIT], '2026-10-04,2026-10-11,2026-10-18');
  });
  await teste('desmarcar remove só aquela', async () => {
    await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-10-11', quitada: false });
    assert.strictEqual(SHEET[1][C.QUIT], '2026-10-04,2026-10-18');
  });
  await teste('recusa semana que não pertence ao parcelamento', async () => {
    const fora = await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-09-27' });  // antes do início
    assert.match(fora.error || '', /não faz parte/i);
    const depois = await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-11-08' }); // 6ª de um plano de 5
    assert.match(depois.error || '', /não faz parte/i);
  });
  await teste('recusa semana que não é domingo', async () => {
    assert.ok((await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-10-06' })).error);
  });
  await teste('plano fica "Quitado" quando a última parcela é marcada', async () => {
    await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-10-11' });
    await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-10-25' });
    assert.strictEqual(SHEET[1][C.ST], 'Ativo', 'ainda falta uma');
    await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-11-01' });
    assert.strictEqual(SHEET[1][C.ST], 'Quitado');
  });
  await teste('desmarcar uma parcela reabre o plano', async () => {
    await A.marcarParcelaDesconto({ rowNum: 2, semana: '2026-11-01', quitada: false });
    assert.strictEqual(SHEET[1][C.ST], 'Ativo');
  });

  // ── edição ──
  await teste('edita valor e motivo sem mexer nas parcelas quitadas', async () => {
    const antes = SHEET[1][C.QUIT];
    const r = await A.updateDescontoProgramado({ rowNum: 2, emp: 'Leandro Venâncio',
      descricao: 'Conserto do carro (revisado)', valor: 600, parcelas: 5, semanaInicio: '2026-10-04' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(SHEET[1][C.VAL], 600);
    assert.strictEqual(SHEET[1][C.DESC], 'Conserto do carro (revisado)');
    assert.strictEqual(SHEET[1][C.QUIT], antes, 'as quitadas não podem mudar numa edição');
  });
  await teste('impede reduzir parcelas deixando uma já quitada de fora', async () => {
    // row 2 tem quitadas até 2026-10-25 (índice 3); reduzir para 2 parcelas as perderia
    const r = await A.updateDescontoProgramado({ rowNum: 2, emp: 'Leandro Venâncio',
      descricao: 'Conserto', valor: 529, parcelas: 2, semanaInicio: '2026-10-04' });
    assert.match(r.error || '', /quitadas fora do novo plano/i);
    assert.strictEqual(SHEET[1][C.N], 5, 'o plano não pode ter sido alterado');
  });
  await teste('impede mover o início deixando quitada órfã', async () => {
    const r = await A.updateDescontoProgramado({ rowNum: 2, emp: 'Leandro Venâncio',
      descricao: 'Conserto', valor: 529, parcelas: 5, semanaInicio: '2026-11-08' });
    assert.ok(r.error, 'deveria recusar');
    assert.strictEqual(SHEET[1][C.INI], '2026-10-04');
  });
  await teste('edição com linha inválida é recusada', async () => {
    assert.ok((await A.updateDescontoProgramado({ ...base, rowNum: 1 })).error);
    assert.ok((await A.updateDescontoProgramado({ ...base, rowNum: 0 })).error);
  });

  // ── exclusão ──
  await teste('exclui o parcelamento', async () => {
    const antes = SHEET.length;
    const r = await A.deleteDescontoProgramado({ rowNum: 3 });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(deletadas, [3]);
    assert.strictEqual(SHEET.length, antes - 1);
  });
  await teste('exclusão com linha inválida é recusada', async () => {
    assert.ok((await A.deleteDescontoProgramado({ rowNum: 1 })).error);
  });

  console.log(fails ? '\n' + fails + ' falha(s).' : '\nAPI de descontos programados ok.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('  FALHOU  exceção não tratada: ' + e.message); process.exit(1); });
