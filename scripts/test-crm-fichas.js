// Montagem das fichas do CRM (api/_crm.js → planejarFichas), lógica pura.
//
// A fixture reproduz os casos reais que motivaram cada regra (levantamento de
// 13/10/2026 sobre 80 obras): grafias diferentes do mesmo cliente, nomes
// parecidos que são pessoas diferentes, fases da mesma casa, obra sem telefone,
// lixo no campo de nome e fichas pré-existentes.
//
// Rodar: node scripts/test-crm-fichas.js
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const gp = path.join(ROOT, 'api', '_google.js');
require.cache[require.resolve(gp)] = { id: gp, filename: gp, loaded: true,
  exports: { normStr: s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ') } };
const C = require(path.join(ROOT, 'api', '_crm.js'));

let fails = 0;
const teste = (nome, fn) => {
  try { fn(); console.log('  ok  ' + nome); }
  catch (e) { fails++; console.log('  FALHOU  ' + nome + '\n          ' + e.message); }
};

const cli = (row, nome, fone, empresa, extra = {}) => ({ _row: row, 'Nome do Cliente': nome,
  'Contato do Cliente': fone, 'Empresa do Cliente': empresa || '', ...extra });
const obra = (row, addr, nome, contato, extra = {}) => ({ _row: row, 'Endereço': addr,
  'Nome do Cliente': nome, 'Contato': contato || '', ...extra });

// fichas que já existiam antes do CRM (as 6 da produção têm este formato)
const CLIENTES = [
  cli(2, 'Paul kadilak', '(617) 462-1104', 'Kadilak Homes'),
  cli(3, 'Cris Cahil', '+1 (603) 231-9002', 'Cahil renovations'),
  cli(4, 'Rich Munroe', '+1 (603) 235-9900', ''),
];
const OBRAS = [
  // mesmo cliente, duas grafias, mesmo telefone → UMA ficha (a existente)
  obra(2, '19 Seneca Lane, Wilmington', 'Paul kadilak', '(617) 462-1104'),
  obra(3, '30 Crimson Road Billerica MA', 'Paul Kadilak holmes', '(617) 462-1104'),
  // obra sem telefone, nome igual ao de um grupo com telefone → entra no grupo
  obra(4, '13 Blood rd Hollis', 'Cris Cahil', '+1 (603) 231-9002'),
  obra(5, '146 Nartoff rd Hollis Nh', 'Cris Cahil', ''),
  // grafia diferente E sem telefone, mas nome normalizado igual a um usado pelo grupo
  obra(6, '174 Weirs Rd Gilford NH', 'Cris Bouchard', '(603) 777-7128'),
  obra(7, '174 Weirs Rd Gilford NH - tile', 'Cris boulchard', '(603) 777-7128'),
  obra(8, '88 S Main St Laconia', 'Cris bouchard', '88 S Main St Laconia'),   // endereço no campo telefone
  // nome parecido, telefones DIFERENTES → pessoas diferentes
  obra(9, '81 Thatcher Road Rockport', 'Kate', '7173431312'),
  obra(10, '94 Longridge Gilford', 'Kate - Chris Ronche', '+1 (603) 393-6064'),
  // "Cris" com telefone próprio: nem Cahil nem Bouchard
  obra(11, '93 Taylor st. Nashua', 'Cris', '+1 (603) 689-8563'),
  // moradora: repete, mas na MESMA casa (fases) → tipo Cliente
  obra(12, '190 Pine Street, Holbrook - MA', 'Juliana Stein', '6175713484'),
  obra(13, '190 Pine Street, Holbrook - MA - Fase dois', 'Juliana Stein', '+1 (617) 571-3484'),
  // empresa pelo nome, uma obra só
  obra(14, '148 Garden Street, West Newbury MA', 'Michael European builders', '7706305997'),
  // duplicata duvidosa sem telefone: NÃO pode ser fundida automaticamente
  obra(15, '138 Lowell Rd Wellesley Ma', 'Hubley', '+1 (774) 405-7350'),
  obra(16, '188 West Main Street Westborough', 'Hubley', '+1 (774) 405-7350'),
  obra(17, '11 Connelly Hill Road Hopkinton', 'Hubley Painting (kamil)', ''),
  // a identificar
  obra(18, '66 Knotty way Belmont NH', '', ''),
  obra(19, '640 Washington street in east Walpole', 'Não sei', 'Não sei'),
  obra(20, '373 Eliot st, Ashland MA', '6s', ''),
  // cliente de uma obra, sem telefone
  obra(21, '2 Dellano Lane Wakefield MA', 'Brandon laroche', ''),
  // linha sem endereço é ignorada
  obra(22, '', 'Fantasma', '5555555555'),
];

const plano = C.planejarFichas(CLIENTES, OBRAS);
const fichaDe = nome => plano.resumo.fichas.find(f => f.nome === nome);
const obraId = row => { const u = plano.atualizarObras.find(x => x.rowNum === row); return u ? u.updates[0].val : null; };

// ── identidade ──
teste('as duas grafias do Paul viram a ficha existente', () => {
  assert.strictEqual(obraId(2), 'C001');
  assert.strictEqual(obraId(3), 'C001');
});
teste('fichas existentes ganham ID sem ser duplicadas', () => {
  assert.deepStrictEqual(plano.atualizarClientes.map(x => x.rowNum).sort(), [2, 3, 4]);
  assert.ok(!plano.novas.some(n => /kadilak|cahil|munroe/i.test(n.nome)), 'criou ficha nova para cliente que já existia');
});
teste('obra sem telefone entra no grupo pelo nome', () => assert.strictEqual(obraId(5), obraId(4)));
teste('três grafias do Bouchard, uma sem telefone, viram uma ficha só', () => {
  assert.ok(obraId(6));
  assert.strictEqual(obraId(7), obraId(6));
  assert.strictEqual(obraId(8), obraId(6));
});
teste('as duas "Kate" têm telefones diferentes e ficam separadas', () => assert.notStrictEqual(obraId(9), obraId(10)));
teste('"Cris" com telefone próprio não é Cahil nem Bouchard', () => {
  assert.notStrictEqual(obraId(11), obraId(4));
  assert.notStrictEqual(obraId(11), obraId(6));
});
teste('duplicata duvidosa sem telefone NÃO é fundida', () => {
  assert.strictEqual(obraId(16), obraId(15));
  assert.notStrictEqual(obraId(17), obraId(15), 'Hubley Painting (kamil) foi fundida sem confirmação');
});

// ── a identificar ──
teste('nome vazio, "Não sei" e "6s" ficam a identificar', () => {
  [18, 19, 20].forEach(r => assert.strictEqual(obraId(r), null, 'obra ' + r + ' foi vinculada'));
  assert.strictEqual(plano.resumo.aIdentificar, 3);
});
teste('linha sem endereço é ignorada', () => assert.strictEqual(obraId(22), null));

// ── tipo e origem ──
teste('Juliana repete na mesma casa → Cliente', () => assert.strictEqual(fichaDe('Juliana Stein').tipo, 'Cliente'));
teste('empresa cadastrada → Empreiteiro', () => assert.strictEqual(fichaDe('Paul kadilak').tipo, 'Empreiteiro'));
teste('obras em 2+ endereços → Empreiteiro', () => {
  assert.strictEqual(fichaDe('Hubley').tipo, 'Empreiteiro');
  assert.strictEqual(fichaDe('Rich Munroe') ? fichaDe('Rich Munroe').tipo : 'sem obras', 'sem obras');
});
teste('palavra de empresa no nome → Empreiteiro', () => {
  assert.strictEqual(fichaDe('Michael European builders').tipo, 'Empreiteiro');
  assert.strictEqual(fichaDe('Hubley Painting (kamil)').tipo, 'Empreiteiro');
});
teste('cliente comum de uma obra → Cliente', () => assert.strictEqual(fichaDe('Brandon laroche').tipo, 'Cliente'));
teste('com telefone = Confirmado; só pelo nome = Inferido', () => {
  assert.strictEqual(fichaDe('Kate').origem, 'Confirmado');
  assert.strictEqual(fichaDe('Brandon laroche').origem, 'Inferido');
  assert.strictEqual(fichaDe('Hubley Painting (kamil)').origem, 'Inferido');
});
teste('ficha nova usa a grafia mais frequente', () => {
  const nb = plano.novas.find(n => /bouchard|boulchard/i.test(n.nome));
  assert.strictEqual(nb.nome, 'Cris Bouchard');
});
teste('telefone da ficha nova sai formatado', () => {
  assert.strictEqual(plano.novas.find(n => n.nome === 'Kate').telefone, '(717) 343-1312');
});

// ── IDs ──
teste('IDs sequenciais, sem colisão e a partir do maior existente', () => {
  const ids = [...plano.novas.map(n => n.id), ...plano.atualizarClientes.map(u => u.updates.find(x => x.key === 'ID Cliente').val)];
  assert.strictEqual(new Set(ids).size, ids.length, 'ID repetido');
  ids.forEach(id => assert.match(id, /^C\d{3,}$/));
  const g = C.geradorIds(['C007', 'C002', 'lixo', '']);
  assert.strictEqual(g(), 'C008');
  assert.strictEqual(g(), 'C009');
});

// ── idempotência: o ponto mais importante ──
// Aplica o plano às linhas (como a planilha ficaria) e roda de novo: nada muda.
teste('rodar de novo sobre o resultado não cria nem altera nada', () => {
  const cli2 = CLIENTES.map(c => ({ ...c }));
  plano.atualizarClientes.forEach(u => {
    const c = cli2.find(x => x._row === u.rowNum);
    u.updates.forEach(x => { c[x.key] = x.val; });
  });
  let prox = 100;
  plano.novas.forEach(n => cli2.push(cli(prox++, n.nome, n.telefone, '', { 'ID Cliente': n.id, 'Tipo': n.tipo, 'Origem': n.origem })));
  const obras2 = OBRAS.map(o => ({ ...o }));
  plano.atualizarObras.forEach(u => { obras2.find(x => x._row === u.rowNum)['ID Cliente'] = u.updates[0].val; });

  const de2 = C.planejarFichas(cli2, obras2);
  assert.strictEqual(de2.novas.length, 0, 'criou fichas na 2ª rodada: ' + JSON.stringify(de2.novas.map(n => n.nome)));
  assert.strictEqual(de2.atualizarClientes.length, 0, 'alterou fichas na 2ª rodada');
  assert.strictEqual(de2.atualizarObras.length, 0, 'revinculou obras na 2ª rodada');
  assert.strictEqual(de2.resumo.recorrentes, plano.resumo.recorrentes);
  assert.strictEqual(de2.resumo.aIdentificar, plano.resumo.aIdentificar);
});

teste('nunca sobrescreve o que o Nilmar já definiu', () => {
  const cli3 = [cli(2, 'Paul kadilak', '(617) 462-1104', 'Kadilak Homes', { 'ID Cliente': 'C001', 'Tipo': 'Cliente', 'Origem': 'Nilmar' })];
  const ob3 = [obra(2, '19 Seneca Lane', 'Paul kadilak', '(617) 462-1104', { 'ID Cliente': 'C009' })];   // vínculo manual
  const p3 = C.planejarFichas(cli3, ob3);
  assert.strictEqual(p3.atualizarClientes.length, 0, 'mexeu no tipo/origem definidos pelo Nilmar');
  assert.strictEqual(p3.atualizarObras.length, 0, 'desfez o vínculo manual da obra');
});

teste('nome usado por dois telefones não serve de ponte', () => {
  const p4 = C.planejarFichas([], [
    obra(2, '1 A St', 'Mike', '1111111111'),
    obra(3, '2 B St', 'Mike', '2222222222'),
    obra(4, '3 C St', 'Mike', ''),
  ]);
  const ids = [2, 3, 4].map(r => p4.atualizarObras.find(x => x.rowNum === r).updates[0].val);
  assert.strictEqual(new Set(ids).size, 3, 'a obra sem telefone foi jogada num dos dois "Mike"');
});

console.log(fails ? '\n' + fails + ' falha(s).' : '\nfichas do CRM ok.');
process.exit(fails ? 1 : 0);
