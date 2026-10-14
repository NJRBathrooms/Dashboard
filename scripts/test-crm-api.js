// Ações de servidor do CRM contra uma planilha simulada em memória.
//
// O que mais importa aqui é não estragar a planilha real:
//   - colunas novas entram NO FIM do cabeçalho, sem mexer nas existentes;
//   - a montagem roda duas vezes sem duplicar;
//   - juntar fichas move as obras ANTES de apagar a ficha de origem;
//   - nenhuma ação sobrescreve dado fora do que foi pedido.
//
// Rodar: node scripts/test-crm-api.js
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

// ── planilha em memória ──────────────────────────────────
let SHEETS, IDS;
const H_CLI = ['Carimbo de data/hora', 'Nome do Cliente', 'Contato do Cliente', 'Empresa do Cliente', 'Email do Cliente', 'Observação'];
const H_OBR = ['Endereço', 'Nome do Cliente', 'Contato', 'Escopo', 'Orçamento', 'Data Início Prevista',
  'Data Fim Prevista', 'Link Fotos Antes', 'Finalizada', 'Data Finalização', 'Link Fotos Depois'];

function reset() {
  SHEETS = {
    'Cadastro de Clientes': [H_CLI.slice(),
      ['t', 'Paul kadilak', '(617) 462-1104', 'Kadilak Homes', 'paul@x.com', ''],     // 2
      ['t', 'Cris Cahil', '+1 (603) 231-9002', 'Cahil renovations', '', ''],          // 3
    ],
    'Cadastro de Obras': [H_OBR.slice(),
      ['19 Seneca Lane', 'Paul kadilak', '(617) 462-1104', '', 6480, '', '', '', 'Sim', '2026-07-10', ''],      // 2
      ['30 Crimson Road', 'Paul Kadilak holmes', '(617) 462-1104', '', 1300, '', '', '', 'Sim', '2026-10-11', ''], // 3
      ['13 Blood rd', 'Cris Cahil', '+1 (603) 231-9002', '', 1650, '', '', '', 'Sim', '2026-08-25', ''],        // 4
      ['146 Nartoff rd', 'Cris Cahil', '', '', 1500, '', '', '', 'Sim', '2026-06-06', ''],                      // 5
      ['11 Connelly Hill', 'Hubley Painting (kamil)', '', '', 1200, '', '', '', 'Sim', '2026-04-04', ''],       // 6
      ['138 Lowell Rd', 'Hubley', '+1 (774) 405-7350', '', 1700, '', '', '', 'Sim', '2026-10-11', ''],          // 7
      ['66 Knotty way', '', '', '', '', '', '', '', 'Sim', '2026-06-18', ''],                                    // 8
    ],
    'Registro de Horas': [['Nome do funcionário', 'Hora de entrada', 'Endereço da obra']],
  };
  IDS = { 'Cadastro de Clientes': 11, 'Cadastro de Obras': 22, 'Registro de Horas': 33 };
}
reset();

const trimHeaders = r => { const h = (r || []).map(x => String(x == null ? '' : x).trim()); while (h.length && !h[h.length - 1]) h.pop(); return h; };
const setCell = (title, rowNum, idx, val) => {
  const s = SHEETS[title];
  while (s.length < rowNum) s.push([]);
  const r = s[rowNum - 1];
  while (r.length <= idx) r.push('');
  r[idx] = val;   // o Sheets devolve o texto sem o apóstrofo do forceText
};
let escritas = 0;
const gp = path.join(ROOT, 'api', '_google.js');
require.cache[require.resolve(gp)] = { id: gp, filename: gp, loaded: true, exports: {
  normStr: s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' '),
  loadSheetIndex: async () => ({ tz: 'America/New_York', index: Object.keys(SHEETS).map(title => ({ title, sheetId: IDS[title], headers: trimHeaders(SHEETS[title][0]) })) }),
  findSheetEntry: (index, kws) => index.find(s => kws.every(k => s.headers.some(h => h.toLowerCase().includes(k)))) || null,
  readWorkbook: async () => ({ byTitle: JSON.parse(JSON.stringify(SHEETS)) }),
  rowsToObjects: values => {
    if (!values || values.length < 2) return [];
    const h = values[0].map(x => String(x).trim());
    const out = [];
    for (let r = 1; r < values.length; r++) {
      const o = { _row: r + 1 };
      h.forEach((k, i) => { if (k) o[k] = values[r][i] === undefined ? '' : values[r][i]; });
      if (Object.keys(o).some(k => k !== '_row' && o[k] !== '')) out.push(o);
    }
    return out;
  },
  readColumn: async (title, idx) => SHEETS[title].map(r => (r[idx] === undefined ? '' : r[idx])),
  buildRow: (headers, mapping) => {
    const row = new Array(headers.length).fill('');
    for (const m of mapping) {
      if (m.val === undefined) continue;
      const i = m.fuzzy ? headers.findIndex(h => h.toLowerCase().includes(m.key.toLowerCase())) : headers.indexOf(m.key);
      if (i >= 0) row[i] = m.val;
    }
    return row;
  },
  appendRow: async (title, row) => { escritas++; SHEETS[title].push(row.slice()); },
  appendRows: async (title, rows) => { escritas++; rows.forEach(r => SHEETS[title].push(r.slice())); },
  updateRowCells: async (title, rowNum, headers, ups) => {
    escritas++;
    ups.forEach(u => { const i = headers.indexOf(u.key); if (i >= 0) setCell(title, rowNum, i, u.val); });
  },
  batchUpdateRows: async (title, headers, list) => {
    if (!list || !list.length) return 0;
    escritas++;
    list.forEach(it => it.updates.forEach(u => { const i = headers.indexOf(u.key); if (i >= 0) setCell(title, it.rowNum, i, u.val); }));
    return list.length;
  },
  deleteRow: async (sheetId, rowNum) => {
    escritas++;
    const title = Object.keys(IDS).find(k => IDS[k] === sheetId);
    SHEETS[title].splice(rowNum - 1, 1);
  },
  nowInTz: () => '2026-10-14 10:00:00',
  updateCell: async () => {},
  createSheet: async (title, headers) => { SHEETS[title] = [headers.slice()]; IDS[title] = 44; },
} };

const CRM = require(path.join(ROOT, 'api', '_crm.js'));
const A = require(path.join(ROOT, 'api', '_actions.js'));

// leitura conveniente
const hdr = title => trimHeaders(SHEETS[title][0]);
const linha = (title, rowNum) => { const h = hdr(title); const r = SHEETS[title][rowNum - 1] || []; const o = {}; h.forEach((k, i) => { o[k] = r[i] === undefined ? '' : r[i]; }); return o; };
const obraPorEnd = addr => { const i = SHEETS['Cadastro de Obras'].findIndex(r => r[0] === addr); return i < 0 ? null : linha('Cadastro de Obras', i + 1); };
const fichaPorId = id => { const h = hdr('Cadastro de Clientes'); const ix = h.indexOf('ID Cliente'); const i = SHEETS['Cadastro de Clientes'].findIndex((r, k) => k > 0 && r[ix] === id); return i < 0 ? null : linha('Cadastro de Clientes', i + 1); };
const fichaPorNome = nome => { const i = SHEETS['Cadastro de Clientes'].findIndex((r, k) => k > 0 && r[1] === nome); return i < 0 ? null : linha('Cadastro de Clientes', i + 1); };

let fails = 0;
const teste = async (nome, fn) => {
  try { await fn(); console.log('  ok  ' + nome); }
  catch (e) { fails++; console.log('  FALHOU  ' + nome + '\n          ' + e.message); }
};

(async () => {
  // ── montagem ──
  await teste('colunas novas entram no fim, sem mexer nas existentes', async () => {
    await CRM.crmPreparar();
    assert.deepStrictEqual(hdr('Cadastro de Clientes'), H_CLI.concat(CRM.COLS_CLIENTE));
    assert.deepStrictEqual(hdr('Cadastro de Obras'), H_OBR.concat(CRM.COLS_OBRA));
    assert.strictEqual(linha('Cadastro de Obras', 2)['Endereço'], '19 Seneca Lane', 'deslocou dado existente');
    assert.strictEqual(linha('Cadastro de Obras', 2)['Data Finalização'], '2026-07-10');
  });
  await teste('montagem vincula as obras e reaproveita as fichas existentes', async () => {
    const paul = fichaPorNome('Paul kadilak');
    assert.strictEqual(paul['ID Cliente'], 'C001');
    assert.strictEqual(paul['Tipo'], 'Empreiteiro');
    assert.strictEqual(paul['Origem'], 'Confirmado');
    assert.strictEqual(obraPorEnd('19 Seneca Lane')['ID Cliente'], 'C001');
    assert.strictEqual(obraPorEnd('30 Crimson Road')['ID Cliente'], 'C001');
    assert.strictEqual(obraPorEnd('146 Nartoff rd')['ID Cliente'], fichaPorNome('Cris Cahil')['ID Cliente']);
    assert.strictEqual(obraPorEnd('66 Knotty way')['ID Cliente'], '', 'obra sem cliente foi vinculada');
  });
  await teste('montagem NÃO renomeia as obras', async () => {
    assert.strictEqual(obraPorEnd('30 Crimson Road')['Nome do Cliente'], 'Paul Kadilak holmes');
  });
  await teste('rodar a montagem de novo não muda nada', async () => {
    const antes = JSON.stringify(SHEETS);
    const r = await CRM.crmPreparar();
    assert.strictEqual(r.resumo.fichasNovas, 0);
    assert.strictEqual(JSON.stringify(SHEETS), antes, 'a 2ª rodada alterou a planilha');
  });
  await teste('modo simular devolve o plano sem escrever', async () => {
    reset();
    const n = escritas;
    const r = await CRM.crmPreparar({ simular: true });
    assert.strictEqual(r.simulado, true);
    assert.ok(r.resumo.fichasNovas > 0);
    assert.strictEqual(fichaPorNome('Hubley'), null, 'simular criou ficha');
    assert.ok(escritas - n <= 2, 'simular só pode escrever o cabeçalho (' + (escritas - n) + ' escritas)');
    await CRM.crmPreparar();   // deixa montado para os próximos testes
  });

  // ── salvar ficha ──
  await teste('editar ficha grava tudo e marca origem Nilmar', async () => {
    const r = await CRM.crmSalvarCliente({ id: 'C001', nome: 'Paul Kadilak', tipo: 'Empreiteiro', telefone: '6174621104', empresa: 'Kadilak Homes' });
    assert.strictEqual(r.ok, true);
    const f = fichaPorId('C001');
    assert.strictEqual(f['Nome do Cliente'], 'Paul Kadilak');
    assert.strictEqual(f['Origem'], 'Nilmar');
    assert.strictEqual(f['Contato do Cliente'], '(617) 462-1104');
    assert.strictEqual(f['Email do Cliente'], 'paul@x.com', 'apagou o e-mail que não foi enviado na edição');
  });
  await teste('renomear propaga o nome para as obras da ficha', async () => {
    assert.strictEqual(obraPorEnd('19 Seneca Lane')['Nome do Cliente'], 'Paul Kadilak');
    assert.strictEqual(obraPorEnd('30 Crimson Road')['Nome do Cliente'], 'Paul Kadilak', 'a grafia antiga ficou na obra');
    assert.strictEqual(obraPorEnd('13 Blood rd')['Nome do Cliente'], 'Cris Cahil', 'renomeou obra de outro cliente');
  });
  await teste('criar ficha nova pelo CRM', async () => {
    const r = await CRM.crmSalvarCliente({ nome: 'Varsha Braham', tipo: 'Cliente', telefone: '(508) 341-5700' });
    assert.ok(r.criado);
    assert.match(r.id, /^C\d{3}$/);
    assert.strictEqual(fichaPorId(r.id)['Origem'], 'Nilmar');
  });
  await teste('recusa nome duplicado e tipo inválido', async () => {
    assert.match((await CRM.crmSalvarCliente({ nome: 'cris  CAHIL', tipo: 'Cliente' })).error || '', /Já existe/);
    assert.ok((await CRM.crmSalvarCliente({ nome: 'Novo', tipo: 'Fornecedor' })).error);
    assert.ok((await CRM.crmSalvarCliente({ nome: '', tipo: 'Cliente' })).error);
    assert.ok((await CRM.crmSalvarCliente({ nome: 'Novo', tipo: 'Cliente', telefone: '123' })).error, 'aceitou telefone inválido');
  });

  // ── confirmar ──
  await teste('confirmar só troca a origem (e o tipo, se pedido)', async () => {
    const id = fichaPorNome('Hubley')['ID Cliente'];
    const nomeAntes = fichaPorId(id)['Nome do Cliente'];
    await CRM.crmConfirmarCliente({ id });
    assert.strictEqual(fichaPorId(id)['Origem'], 'Nilmar');
    assert.strictEqual(fichaPorId(id)['Nome do Cliente'], nomeAntes);
    await CRM.crmConfirmarCliente({ id, tipo: 'Cliente' });
    assert.strictEqual(fichaPorId(id)['Tipo'], 'Cliente');
    assert.ok((await CRM.crmConfirmarCliente({ id: 'C999' })).error);
  });

  // ── juntar ──
  await teste('juntar move as obras, herda o que falta e apaga a origem', async () => {
    const destino = fichaPorNome('Hubley')['ID Cliente'];
    const origem = fichaPorNome('Hubley Painting (kamil)')['ID Cliente'];
    const r = await CRM.crmJuntarClientes({ origem, destino });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.obrasMovidas, 1);
    assert.strictEqual(obraPorEnd('11 Connelly Hill')['ID Cliente'], destino);
    assert.strictEqual(obraPorEnd('11 Connelly Hill')['Nome do Cliente'], 'Hubley');
    assert.strictEqual(fichaPorId(origem), null, 'a ficha de origem não foi apagada');
    assert.ok(fichaPorId(destino), 'apagou a ficha errada');
  });
  await teste('juntar recusa telefones diferentes sem confirmação', async () => {
    const a = fichaPorNome('Varsha Braham')['ID Cliente'];
    const b = fichaPorNome('Cris Cahil')['ID Cliente'];
    const r = await CRM.crmJuntarClientes({ origem: a, destino: b });
    assert.ok(r.telefonesDiferentes);
    assert.ok(fichaPorId(a), 'apagou mesmo recusando');
  });
  await teste('juntar recusa a mesma ficha e IDs inexistentes', async () => {
    assert.ok((await CRM.crmJuntarClientes({ origem: 'C001', destino: 'C001' })).error);
    assert.ok((await CRM.crmJuntarClientes({ origem: 'C998', destino: 'C001' })).error);
  });

  // ── vincular obra ──
  await teste('vincular obra a uma ficha traz o nome e o telefone', async () => {
    const id = fichaPorNome('Varsha Braham')['ID Cliente'];
    const r = await CRM.crmVincularObra({ addr: '66 knotty WAY', id });
    assert.strictEqual(r.ok, true, r.error);
    const o = obraPorEnd('66 Knotty way');
    assert.strictEqual(o['ID Cliente'], id);
    assert.strictEqual(o['Nome do Cliente'], 'Varsha Braham');
    assert.strictEqual(o['Contato'], '(508) 341-5700');
  });
  await teste('vincular não troca telefone que a obra já tem', async () => {
    const id = fichaPorNome('Varsha Braham')['ID Cliente'];
    await CRM.crmVincularObra({ addr: '13 Blood rd', id });
    assert.strictEqual(obraPorEnd('13 Blood rd')['Contato'], '+1 (603) 231-9002');
  });
  await teste('desvincular devolve a obra para "a identificar"', async () => {
    await CRM.crmVincularObra({ addr: '13 Blood rd', id: '' });
    assert.strictEqual(obraPorEnd('13 Blood rd')['ID Cliente'], '');
  });
  await teste('vincular recusa obra ou ficha inexistente', async () => {
    assert.ok((await CRM.crmVincularObra({ addr: '999 Nowhere', id: 'C001' })).error);
    assert.ok((await CRM.crmVincularObra({ addr: '13 Blood rd', id: 'C999' })).error);
  });

  // ── data de conclusão ──
  await teste('aceitar a sugestão grava a data e marca conferida', async () => {
    await CRM.crmDataConclusao({ addr: '30 Crimson Road', data: '2026-06-19' });
    const o = obraPorEnd('30 Crimson Road');
    assert.strictEqual(o['Data Finalização'], '2026-06-19');
    assert.strictEqual(o['Conclusão Conferida'], 'Sim');
  });
  await teste('manter não mexe na data, só marca conferida', async () => {
    await CRM.crmDataConclusao({ addr: '138 Lowell Rd', manter: true });
    const o = obraPorEnd('138 Lowell Rd');
    assert.strictEqual(o['Data Finalização'], '2026-10-11');
    assert.strictEqual(o['Conclusão Conferida'], 'Sim');
  });
  await teste('recusa data inválida ou no futuro', async () => {
    assert.ok((await CRM.crmDataConclusao({ addr: '13 Blood rd', data: '19/06/2026' })).error);
    assert.ok((await CRM.crmDataConclusao({ addr: '13 Blood rd', data: '2099-01-01' })).error);
  });

  // ── formulários ──
  await teste('obra com cliente existente recebe o ID dele', async () => {
    const r = await A.addObra({ addr: '200 Follen Rd', cliente: 'Paul Kadilak', contato: '6174621104', orcamento: '1350', clienteId: 'C001' });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(obraPorEnd('200 Follen Rd')['ID Cliente'], 'C001');
  });
  await teste('obra com cliente novo cria a ficha com o tipo', async () => {
    const r = await A.addObra({ addr: '5 New St', cliente: 'Laura Diaz', contato: '9785551234', orcamento: '9000', clienteTipo: 'Cliente' });
    assert.strictEqual(r.ok, true, r.error);
    const id = obraPorEnd('5 New St')['ID Cliente'];
    assert.match(id, /^C\d{3}$/);
    assert.strictEqual(fichaPorId(id)['Tipo'], 'Cliente');
    assert.strictEqual(fichaPorId(id)['Contato do Cliente'], '(978) 555-1234');
  });
  await teste('"cliente novo" com nome já cadastrado reaproveita a ficha', async () => {
    const antes = SHEETS['Cadastro de Clientes'].length;
    await A.addObra({ addr: '6 Other St', cliente: 'laura  diaz', contato: '9785551234', orcamento: '100', clienteTipo: 'Cliente' });
    assert.strictEqual(SHEETS['Cadastro de Clientes'].length, antes, 'criou ficha duplicada');
    assert.strictEqual(obraPorEnd('6 Other St')['ID Cliente'], obraPorEnd('5 New St')['ID Cliente']);
  });
  await teste('obra recusa tipo inválido', async () => {
    assert.ok((await A.addObra({ addr: '7 X St', cliente: 'Y', contato: '1', clienteTipo: 'Outro' })).error);
  });
  await teste('incluir cliente exige o tipo e nasce com ID', async () => {
    assert.ok((await A.addCliente({ nome: 'Zed', contato: '6175550000' })).error, 'aceitou sem tipo');
    const r = await A.addCliente({ nome: 'Zed', contato: '6175550000', tipo: 'Empreiteiro', empresa: 'Zed Co' });
    assert.strictEqual(r.ok, true, r.error);
    const f = fichaPorId(r.id);
    assert.strictEqual(f['Tipo'], 'Empreiteiro');
    assert.strictEqual(f['Empresa do Cliente'], 'Zed Co');
    assert.strictEqual(f['Origem'], 'Nilmar');
  });
  await teste('incluir cliente recusa nome duplicado', async () => {
    assert.match((await A.addCliente({ nome: 'ZED', contato: '1', tipo: 'Cliente' })).error || '', /Já existe/);
  });

  // ══ PARTE 2: contato ═════════════════════════════════════
  const H = 'CRM Contatos';
  const contatos = () => (SHEETS[H] || []).slice(1);
  const paul = () => fichaPorId('C001');

  await teste('registrar cria a aba de histórico e grava o contato', async () => {
    const r = await CRM.crmRegistrarContato({ id: 'C001', addr: '19 Seneca Lane', destinatario: 'Empreiteiro',
      marco: '6m', resultado: 'Enviado', canal: 'WhatsApp', anotacao: 'vai pensar' });
    assert.strictEqual(r.ok, true, r.error);
    assert.deepStrictEqual(SHEETS[H][0], CRM.CONTATOS_HEADERS);
    const c = contatos()[0];
    assert.deepStrictEqual([c[1], c[2], c[3], c[4], c[5], c[6], c[7]],
      ['C001', '19 Seneca Lane', 'Empreiteiro', '6m', 'Enviado', 'WhatsApp', 'vai pensar']);
  });
  await teste('canal usado vira o canal lembrado da ficha', async () => {
    assert.strictEqual(paul()['Canal Preferido'], 'WhatsApp');
  });
  await teste('o mesmo marco não pode ser registrado duas vezes', async () => {
    const r = await CRM.crmRegistrarContato({ id: 'C001', addr: '19 SENECA lane', destinatario: 'Empreiteiro',
      marco: '6m', resultado: 'Dispensado', canal: '' });
    assert.match(r.error || '', /já foi registrado/);
    assert.strictEqual(contatos().length, 1);
  });
  await teste('mesmo marco para o MORADOR é outro registro e não mexe no canal da ficha', async () => {
    const r = await CRM.crmRegistrarContato({ id: 'C001', addr: '19 Seneca Lane', destinatario: 'Cliente',
      marco: '6m', resultado: 'Enviado', canal: 'SMS', morador: true });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(contatos().length, 2);
    assert.strictEqual(paul()['Canal Preferido'], 'WhatsApp', 'o SMS do morador virou canal do empreiteiro');
  });
  await teste('dispensar não muda o canal', async () => {
    await CRM.crmRegistrarContato({ id: 'C001', addr: '30 Crimson Road', destinatario: 'Empreiteiro', marco: '6m', resultado: 'Dispensado', canal: '' });
    assert.strictEqual(paul()['Canal Preferido'], 'WhatsApp');
  });
  await teste('registro recusa dado inválido', async () => {
    const base = { id: 'C001', addr: '19 Seneca Lane', destinatario: 'Cliente', marco: '1a', resultado: 'Enviado', canal: 'SMS' };
    assert.ok((await CRM.crmRegistrarContato({ ...base, marco: '7m' })).error);
    assert.ok((await CRM.crmRegistrarContato({ ...base, destinatario: 'Vizinho' })).error);
    assert.ok((await CRM.crmRegistrarContato({ ...base, resultado: 'Talvez' })).error);
    assert.ok((await CRM.crmRegistrarContato({ ...base, canal: 'Pombo' })).error);
    assert.ok((await CRM.crmRegistrarContato({ ...base, addr: '999 Nowhere' })).error);
    assert.strictEqual(contatos().length, 3, 'gravou registro inválido');
  });

  await teste('desfazer confere a linha antes de apagar', async () => {
    const r = await CRM.crmDesfazerContato({ rowNum: 2, addr: '19 Seneca Lane', destinatario: 'Empreiteiro', marco: '1a' });
    assert.match(r.error || '', /mudou/);
    assert.strictEqual(contatos().length, 3);
  });
  await teste('desfazer apaga o registro certo', async () => {
    const r = await CRM.crmDesfazerContato({ rowNum: 3, addr: '19 Seneca Lane', destinatario: 'Cliente', marco: '6m' });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(contatos().length, 2);
    assert.ok(!contatos().some(c => c[3] === 'Cliente'), 'apagou o registro errado');
  });

  await teste('autorizar morador grava nome, telefone formatado e data', async () => {
    const r = await CRM.crmAutorizarMorador({ addr: '13 Blood rd', nome: 'Jane Doe', telefone: '978 555 1234', data: '2026-10-14' });
    assert.strictEqual(r.ok, true, r.error);
    const o = obraPorEnd('13 Blood rd');
    assert.strictEqual(o['Morador Nome'], 'Jane Doe');
    assert.strictEqual(o['Morador Telefone'], '(978) 555-1234');
    assert.strictEqual(o['Autorizado Em'], '2026-10-14');
  });
  await teste('autorizar exige nome e telefone válido', async () => {
    assert.ok((await CRM.crmAutorizarMorador({ addr: '13 Blood rd', nome: '', telefone: '9785551234' })).error);
    assert.ok((await CRM.crmAutorizarMorador({ addr: '13 Blood rd', nome: 'X', telefone: '555' })).error);
    assert.strictEqual(obraPorEnd('13 Blood rd')['Morador Nome'], 'Jane Doe', 'tentativa inválida apagou o morador');
  });
  await teste('remover autorização limpa os três campos', async () => {
    await CRM.crmAutorizarMorador({ addr: '13 Blood rd', remover: true });
    const o = obraPorEnd('13 Blood rd');
    assert.deepStrictEqual([o['Morador Nome'], o['Morador Telefone'], o['Autorizado Em']], ['', '', '']);
  });

  await teste('"Não contatar" liga e desliga', async () => {
    await CRM.crmNaoContatar({ id: 'C001', valor: true });
    assert.strictEqual(paul()['Não Contatar'], 'Sim');
    await CRM.crmNaoContatar({ id: 'C001', valor: false });
    assert.strictEqual(paul()['Não Contatar'], '');
    assert.ok((await CRM.crmNaoContatar({ id: 'C999', valor: true })).error);
  });

  await teste('juntar fichas leva junto o histórico de contato', async () => {
    const novo = await CRM.crmSalvarCliente({ nome: 'Paul K Duplicado', tipo: 'Empreiteiro' });
    await CRM.crmRegistrarContato({ id: novo.id, addr: '200 Follen Rd', destinatario: 'Empreiteiro', marco: '6m', resultado: 'Enviado', canal: 'SMS' });
    const r = await CRM.crmJuntarClientes({ origem: novo.id, destino: 'C001' });
    assert.strictEqual(r.ok, true, r.error);
    assert.ok(contatos().filter(c => c[2] === '200 Follen Rd').every(c => c[1] === 'C001'), 'o contato ficou com o ID apagado');
  });

  console.log(fails ? '\n' + fails + ' falha(s).' : '\nAPI do CRM ok.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('  FALHOU  exceção não tratada: ' + e.stack); process.exit(1); });
