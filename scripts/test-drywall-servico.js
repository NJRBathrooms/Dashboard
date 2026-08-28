// Testa as ações de serviço do drywall (editar/excluir o endereço inteiro) e a
// movimentação de um lançamento entre serviços, contra uma planilha simulada com
// os mesmos cabeçalhos da produção.
//
// A aba Drywall é desnormalizada: um "serviço" é o conjunto de linhas com o mesmo
// endereço, e a receita mora numa linha só. Isso cria duas armadilhas que estes
// testes cobrem: apagar N linhas desloca as de baixo (tem que ser de baixo para
// cima), e mover um lançamento pode levar embora a receita do serviço de origem.
//
// Rodar: node scripts/test-drywall-servico.js
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const HEADERS = ['Carimbo de data/hora', 'Data', 'Cliente', 'Endereço', 'Valor Cobrado ($)',
  'Pessoa', 'Companhia', 'Diária ($)', 'Observações'];
const C = { TS: 0, DATA: 1, CLI: 2, ADDR: 3, VAL: 4, PES: 5, COMP: 6, DIA: 7, OBS: 8 };

let SHEET, deletadas;
function reset() {
  SHEET = [HEADERS.slice(),
    // ts, data, cliente, endereço, valor, pessoa, companhia, diária, obs
    ['t', '2026-08-14', 'cliente exemplo', '111 exemplo',         400, 'Carlos', 'DW Pro', 200, ''], // row 2
    ['t', '2026-08-14', 'exemplo 2',       '222 exemplo novo',    333, 'Carlos', 'DW Pro', 200, ''], // row 3
    ['t', '2026-08-23', 'Ronaldo',         '333 poneis malditos', 850, 'Junin',  'DW Pro', 350, ''], // row 4
    ['t', '2026-08-23', 'cliente exemplo', '111 exemplo',          '', 'Junin',  'DW Pro', 350, ''], // row 5
    ['t', '2026-08-23', 'exemplo 2',       '222 exemplo novo',     '', 'Junin',  'DW Pro', 350, ''], // row 6
    ['t', '2026-08-23', 'cliente exemplo', '111 exemplo',          '', 'Carlos', 'DW Pro', 200, ''], // row 7
    ['t', '2026-08-23', 'Ronaldo',         '333 poneis malditos',  '', 'Carlos', 'DW Pro', 200, ''], // row 8
  ];
  deletadas = [];
}

const gpath = path.join(ROOT, 'api', '_google.js');
require.cache[require.resolve(gpath)] = { id: gpath, filename: gpath, loaded: true, exports: {
  normStr: s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '),
  loadSheetIndex: async () => ({ tz: 'America/New_York', index: [{ title: 'Drywall', sheetId: 7, headers: HEADERS }] }),
  findSheetEntry: (index, kws) => index.find(s => kws.every(k => s.headers.some(h => h.toLowerCase().includes(k)))) || null,
  createSheet: async () => {},
  nowInTz: () => '2026-08-28 10:00:00',
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
    ups.forEach(u => {
      const i = headers.indexOf(u.key);
      if (i < 0) return;
      // mesmo comportamento do _google.js real: forceText prefixa apóstrofo
      let v = u.val;
      if (u.forceText && v !== '' && v != null) v = "'" + String(v);
      SHEET[rowNum - 1][i] = v;
    });
  },
  deleteRow: async (sheetId, rowNum) => { deletadas.push(rowNum); SHEET.splice(rowNum - 1, 1); },
} };

const A = require(path.join(ROOT, 'api', '_actions.js'));

let n = 0;
const t = (nome, fn) => fn().then(() => { n++; console.log('  ok  ' + nome); },
  e => { console.log('  FALHOU  ' + nome + '\n          ' + e.message); process.exitCode = 1; });

const linhasDe = addr => SHEET.slice(1).filter(r => r[C.ADDR] === addr);
const col = (addr, c) => linhasDe(addr).map(r => r[c]);

(async () => {
  // ── editar o serviço ──
  await t('trocar o cliente altera TODAS as linhas do serviço', async () => {
    reset();
    const r = await A.updateDrywallServico({ addrOrig: '111 exemplo', cliente: 'Novo Nome' });
    assert.deepStrictEqual(r, { ok: true, linhas: 3 });
    assert.deepStrictEqual(col('111 exemplo', C.CLI), ['Novo Nome', 'Novo Nome', 'Novo Nome']);
    assert.deepStrictEqual(col('222 exemplo novo', C.CLI), ['exemplo 2', 'exemplo 2'], 'outro serviço não pode mudar');
  });

  await t('trocar o endereço renomeia todas as linhas e não toca nos outros serviços', async () => {
    reset();
    await A.updateDrywallServico({ addrOrig: '111 exemplo', addr: '111 Exemplo St' });
    assert.strictEqual(linhasDe('111 exemplo').length, 0);
    assert.strictEqual(linhasDe('111 Exemplo St').length, 3);
    assert.strictEqual(linhasDe('222 exemplo novo').length, 2);
    assert.strictEqual(linhasDe('333 poneis malditos').length, 2);
  });

  await t('renomear para um endereço que já existe é recusado (juntaria dois serviços)', async () => {
    reset();
    const r = await A.updateDrywallServico({ addrOrig: '111 exemplo', addr: '222 exemplo novo' });
    assert.ok(r.error && /já existe/i.test(r.error), 'deveria recusar: ' + JSON.stringify(r));
    assert.strictEqual(linhasDe('111 exemplo').length, 3, 'nada pode ter sido alterado');
    assert.strictEqual(linhasDe('222 exemplo novo').length, 2);
  });

  await t('mudar só a caixa do próprio endereço é permitido', async () => {
    reset();
    const r = await A.updateDrywallServico({ addrOrig: '111 exemplo', addr: '111 EXEMPLO' });
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(linhasDe('111 EXEMPLO').length, 3);
  });

  await t('a receita fica numa linha só, na de menor número', async () => {
    reset();
    await A.updateDrywallServico({ addrOrig: '111 exemplo', valorCobrado: '999' });
    assert.deepStrictEqual(col('111 exemplo', C.VAL), [999, '', ''], 'só a primeira linha carrega o valor');
  });

  await t('valor que estava numa linha errada é normalizado para a primeira', async () => {
    reset();
    SHEET[1][C.VAL] = '';    // row 2 sem valor
    SHEET[6][C.VAL] = 500;   // row 7 com valor (linha errada)
    await A.updateDrywallServico({ addrOrig: '111 exemplo', valorCobrado: '500' });
    assert.deepStrictEqual(col('111 exemplo', C.VAL), [500, '', ''], 'valor órfão tem que sair da linha 7');
  });

  await t('limpar a receita apaga o valor de todas as linhas', async () => {
    reset();
    await A.updateDrywallServico({ addrOrig: '111 exemplo', valorCobrado: '' });
    assert.deepStrictEqual(col('111 exemplo', C.VAL), ['', '', '']);
  });

  await t('serviço inexistente e valor inválido são recusados', async () => {
    reset();
    assert.ok((await A.updateDrywallServico({ addrOrig: 'não existe', cliente: 'X' })).error);
    assert.ok((await A.updateDrywallServico({ addrOrig: '111 exemplo', valorCobrado: '-5' })).error);
    assert.ok((await A.updateDrywallServico({ addrOrig: '111 exemplo', addr: '  ' })).error);
    assert.ok((await A.updateDrywallServico({ addrOrig: '111 exemplo' })).error, 'sem campo nenhum');
    assert.deepStrictEqual(col('111 exemplo', C.VAL), [400, '', ''], 'nada pode ter mudado');
  });

  // ── excluir o serviço ──
  await t('excluir o serviço apaga exatamente as linhas dele', async () => {
    reset();
    const r = await A.deleteDrywallServico({ addr: '111 exemplo' });
    assert.deepStrictEqual(r, { ok: true, apagadas: 3 });
    assert.strictEqual(SHEET.length - 1, 4, 'sobram 4 linhas');
    assert.strictEqual(linhasDe('111 exemplo').length, 0);
  });

  await t('excluir de baixo para cima — os outros serviços sobrevivem intactos', async () => {
    reset();
    await A.deleteDrywallServico({ addr: '111 exemplo' }); // rows 2, 5, 7
    // se apagasse de cima para baixo, os índices deslocariam e levariam linhas erradas
    assert.deepStrictEqual(deletadas, [7, 5, 2], 'a ordem de exclusão precisa ser decrescente');
    const restantes = SHEET.slice(1).map(r => r[C.ADDR] + ' / ' + r[C.PES] + ' / ' + r[C.DATA]);
    assert.deepStrictEqual(restantes, [
      '222 exemplo novo / Carlos / 2026-08-14',
      '333 poneis malditos / Junin / 2026-08-23',
      '222 exemplo novo / Junin / 2026-08-23',
      '333 poneis malditos / Carlos / 2026-08-23',
    ]);
    assert.deepStrictEqual(col('222 exemplo novo', C.VAL), [333, ''], 'receita dos outros preservada');
    assert.deepStrictEqual(col('333 poneis malditos', C.VAL), [850, '']);
  });

  await t('excluir serviço inexistente é recusado sem apagar nada', async () => {
    reset();
    const r = await A.deleteDrywallServico({ addr: 'não existe' });
    assert.ok(r.error);
    assert.strictEqual(SHEET.length - 1, 7);
    assert.deepStrictEqual(deletadas, []);
  });

  // ── mover um lançamento entre serviços ──
  await t('mover o lançamento que carrega a receita: o valor FICA no serviço de origem', async () => {
    reset();
    // row 2 é a linha do "111 exemplo" que tem os $400
    await A.updateDrywall({ rowNum: 2, addr: '333 poneis malditos' });
    assert.strictEqual(SHEET[1][C.ADDR], '333 poneis malditos', 'a linha mudou de serviço');
    assert.strictEqual(SHEET[1][C.VAL], '', 'a linha vai limpa para o destino');
    assert.deepStrictEqual(col('111 exemplo', C.VAL), [400, ''], 'os $400 continuam com o serviço de origem');
    assert.deepStrictEqual(col('333 poneis malditos', C.VAL), ['', 850, ''], 'destino mantém a receita dele');
  });

  await t('mover um lançamento sem receita não mexe em valor nenhum', async () => {
    reset();
    await A.updateDrywall({ rowNum: 7, addr: '222 exemplo novo' }); // linha sem valor
    assert.deepStrictEqual(col('111 exemplo', C.VAL), [400, '']);
    assert.deepStrictEqual(col('222 exemplo novo', C.VAL), [333, '', '']);
  });

  await t('mover o único lançamento de um serviço não quebra', async () => {
    reset();
    SHEET = [HEADERS.slice(), ['t', '2026-08-14', 'Só um', 'unico addr', 700, 'Carlos', 'DW', 200, '']];
    const r = await A.updateDrywall({ rowNum: 2, addr: 'outro addr' });
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(SHEET[1][C.ADDR], 'outro addr');
    assert.strictEqual(SHEET[1][C.VAL], '', 'sem linha de origem sobrando, o valor sai junto');
  });

  await t('editar data/pessoa/diária do lançamento não afeta a receita', async () => {
    reset();
    await A.updateDrywall({ rowNum: 2, data: '2026-08-20', pessoa: 'Ana', diaria: '180', obs: 'trocou' });
    assert.strictEqual(SHEET[1][C.DATA], "'2026-08-20", 'data gravada como texto');
    assert.strictEqual(SHEET[1][C.PES], 'Ana');
    assert.strictEqual(SHEET[1][C.DIA], 180);
    assert.strictEqual(SHEET[1][C.OBS], 'trocou');
    assert.deepStrictEqual(col('111 exemplo', C.VAL), [400, '', '']);
  });

  await t('data inválida e linha inválida são recusadas', async () => {
    reset();
    assert.ok((await A.updateDrywall({ rowNum: 2, data: '20/08/2026' })).error);
    assert.ok((await A.updateDrywall({ rowNum: 1, pessoa: 'X' })).error, 'linha 1 é o cabeçalho');
    assert.ok((await A.updateDrywall({ rowNum: 2 })).error, 'sem campo nenhum');
    assert.ok((await A.updateDrywall({ rowNum: 2, addr: '' })).error);
  });

  console.log('\n' + n + ' testes passaram.');
})();
