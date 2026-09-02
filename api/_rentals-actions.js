// ============================================================
// NJR Casas de Aluguel — ações de escrita (Sheets + Drive)
// ============================================================

const R = require('./_rentals');
const { driveApi } = require('./_google');
const { uploadFile } = require('./_drive');

const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? '' : Math.round(n * 100) / 100; };
const clean = v => String(v == null ? '' : v).trim();
const norm = s => clean(s).toLowerCase().replace(/\s+/g, ' ');

async function ctx(title) {
  const ssId = await R.getRentalsSS();
  const index = await R.loadRentalIndex(ssId);
  const sh = index.find(s => s.title === title);
  return { ssId, sh };
}
// localiza a linha (nº real) onde a coluna colName == valor (case-insensitive/trim)
async function findRow(ssId, sh, colName, value) {
  const idx = sh.headers.indexOf(colName);
  if (idx < 0) return 0;
  const col = await R.readRentalColumn(ssId, sh.title, idx);
  for (let i = 1; i < col.length; i++) if (norm(col[i]) === norm(value)) return i + 1;
  return 0;
}

// ── CASAS: reordenar (ordem manual persistida) ────────────
async function reorderCasas(params) {
  const order = Array.isArray(params.order) ? params.order.map(clean).filter(Boolean) : [];
  if (!order.length) return { error: 'Ordem vazia.' };
  const { ssId, sh } = await ctx('Casas');
  if (sh.headers.indexOf('Ordem') < 0) return { error: 'Coluna Ordem indisponível; recarregue a página.' };
  const addrIdx = sh.headers.indexOf('Endereço');
  const addrCol = await R.readRentalColumn(ssId, sh.title, addrIdx);
  const pairs = [];
  order.forEach((addr, i) => {
    for (let r = 1; r < addrCol.length; r++) {
      if (norm(addrCol[r]) === norm(addr)) { pairs.push({ rowNum: r + 1, val: i + 1 }); break; }
    }
  });
  await R.batchSetColumn(ssId, sh.title, sh.headers, 'Ordem', pairs);
  return { ok: true, count: pairs.length };
}

// serial do Sheets (ou string) → ISO YYYY-MM-DD (texto)
function serialToIso(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return d.toISOString().slice(0, 10); }
  const s = String(v).trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (m[1] + '-' + m[2] + '-' + m[3]) : s;
}

// arquiva o inquilino atual de uma casa na aba "Histórico de Inquilinos"
async function archiveTenant(ssId, oldRow, motivo) {
  const inq = clean(oldRow['Inquilino']);
  if (!inq) return;
  const { sh } = await ctx('Histórico de Inquilinos');
  if (!sh) return;
  const row = R.buildRow(sh.headers, [
    { key: 'Carimbo de data/hora', val: R.nowInTz() },
    { key: 'Endereço', val: clean(oldRow['Endereço']) },
    { key: 'Inquilino', val: inq },
    { key: 'Contato do Inquilino', val: clean(oldRow['Contato do Inquilino']), forceText: true },
    { key: 'Início do Contrato', val: serialToIso(oldRow['Início do Contrato']), forceText: true },
    { key: 'Fim do Contrato', val: serialToIso(oldRow['Fim do Contrato']), forceText: true },
    { key: 'Encerrado em', val: new Date().toISOString().slice(0, 10), forceText: true },
    { key: 'Motivo', val: motivo || '' },
    { key: 'Observações', val: '' },
  ]);
  await R.appendRental(ssId, sh.title, row);
}

// remove o inquilino de uma casa (arquiva no histórico e libera a casa)
async function removerInquilino(params) {
  const { ssId, sh } = await ctx('Casas');
  const addr = clean(params.addr);
  if (!addr) return { error: 'Endereço obrigatório.' };
  const rowNum = await findRow(ssId, sh, 'Endereço', addr);
  if (!rowNum) return { error: 'Casa não encontrada.' };
  const oldRow = await R.readRentalRow(ssId, sh.title, rowNum, sh.headers);
  await archiveTenant(ssId, oldRow, clean(params.motivo) || 'Saída do inquilino');
  await R.updateRentalCells(ssId, sh.title, rowNum, sh.headers, [
    { key: 'Carimbo de data/hora', val: R.nowInTz() },
    { key: 'Inquilino', val: '' },
    { key: 'Contato do Inquilino', val: '' },
    { key: 'Status', val: 'Vacância' },
    { key: 'Início do Contrato', val: '' },
    { key: 'Fim do Contrato', val: '' },
  ]);
  return { ok: true };
}

// ── CASAS (upsert por Endereço) ───────────────────────────
async function saveCasa(params) {
  const { ssId, sh } = await ctx('Casas');
  const addr = clean(params.addr || params['Endereço']);
  if (!addr) return { error: 'Endereço obrigatório.' };
  const map = [
    { key: 'Endereço', val: addr },
    { key: 'Inquilino', val: clean(params.inquilino) },
    { key: 'Contato do Inquilino', val: clean(params.contato), forceText: true },
    { key: 'Status', val: clean(params.status) || 'Ocupada' },
    { key: 'Aluguel Mensal', val: num(params.aluguel) },
    { key: 'Security Deposit', val: num(params.deposit) },
    { key: 'Início do Contrato', val: clean(params.inicio) },
    { key: 'Fim do Contrato', val: clean(params.fim) },
    { key: 'Seguradora', val: clean(params.seguradora) },
    { key: 'Vigência do Seguro', val: clean(params.vigenciaSeguro) },
    { key: 'Valor do Seguro', val: num(params.valorSeguro) },
    { key: 'Periodicidade do Seguro', val: clean(params.periodSeguro) },
    { key: 'Mortgage Mensal', val: num(params.mortgage) },
    { key: 'Valor da Água', val: num(params.agua) },
    { key: 'Periodicidade da Água', val: clean(params.periodAgua) },
    { key: 'Observações', val: clean(params.obs) },
  ];
  const rowNum = await findRow(ssId, sh, 'Endereço', addr);
  if (rowNum) {
    // se o inquilino mudou (troca ou saída), arquiva o anterior no histórico
    if (params.inquilino !== undefined) {
      const oldRow = await R.readRentalRow(ssId, sh.title, rowNum, sh.headers);
      const oldInq = clean(oldRow['Inquilino']), newInq = clean(params.inquilino);
      if (oldInq && norm(oldInq) !== norm(newInq)) {
        await archiveTenant(ssId, oldRow, newInq ? 'Troca de inquilino' : 'Saída do inquilino');
      }
    }
    // não sobrescreve campos não enviados: só atualiza os que vieram definidos
    const updates = map.filter(m => params[keyToParam(m.key)] !== undefined || m.key === 'Endereço');
    await R.updateRentalCells(ssId, sh.title, rowNum, sh.headers, updates.concat([{ key: 'Carimbo de data/hora', val: R.nowInTz() }]));
    return { ok: true, updated: true };
  }
  const row = R.buildRow(sh.headers, [{ key: 'Carimbo de data/hora', val: R.nowInTz() }].concat(map));
  await R.appendRental(ssId, sh.title, row);
  return { ok: true, created: true };
}
// mapeia nome de header → nome do parâmetro enviado pelo frontend (para saber o que foi editado)
function keyToParam(h) {
  const m = {
    'Endereço': 'addr', 'Inquilino': 'inquilino', 'Contato do Inquilino': 'contato', 'Status': 'status',
    'Aluguel Mensal': 'aluguel', 'Security Deposit': 'deposit', 'Início do Contrato': 'inicio', 'Fim do Contrato': 'fim',
    'Seguradora': 'seguradora', 'Vigência do Seguro': 'vigenciaSeguro', 'Valor do Seguro': 'valorSeguro',
    'Periodicidade do Seguro': 'periodSeguro', 'Mortgage Mensal': 'mortgage', 'Valor da Água': 'agua',
    'Periodicidade da Água': 'periodAgua', 'Observações': 'obs',
  };
  return m[h] || h;
}

async function deleteCasa(params) {
  const { ssId, sh } = await ctx('Casas');
  const rowNum = parseInt(params.rowNum) || await findRow(ssId, sh, 'Endereço', clean(params.addr));
  if (!rowNum || rowNum < 2) return { error: 'Casa não encontrada.' };
  await R.deleteRentalRow(ssId, sh.sheetId, rowNum);
  return { ok: true };
}

// ── RECEBIMENTOS (marcar aluguel recebido; upsert por Endereço+Competência) ──
function rentStatus(competencia, dataPagamento) {
  const [y, m] = String(competencia).split('-').map(Number);
  const pay = new Date(dataPagamento + 'T12:00:00');
  const day1 = new Date(y, m - 1, 1, 12);
  const day10 = new Date(y, m - 1, 10, 23, 59, 59);
  if (pay <= day1) return { status: 'Pago no prazo', multa: 0 };
  if (pay <= day10) return { status: 'Atraso sem multa', multa: 0 };
  return { status: 'Atraso com multa', multa: 50 };
}

async function markRecebido(params) {
  const { ssId, sh } = await ctx('Recebimentos');
  const addr = clean(params.addr);
  const comp = clean(params.competencia); // YYYY-MM
  if (!addr || !/^\d{4}-\d{2}$/.test(comp)) return { error: 'Endereço e competência (YYYY-MM) obrigatórios.' };
  const dataPag = clean(params.dataPagamento) || new Date().toISOString().slice(0, 10);
  const aluguel = num(params.valorAluguel) || 0;
  const { status, multa } = rentStatus(comp, dataPag);
  const total = (Number(aluguel) || 0) + multa;
  const fields = [
    { key: 'Endereço', val: addr },
    { key: 'Competência', val: comp, forceText: true },
    { key: 'Valor do Aluguel', val: aluguel },
    { key: 'Data do Pagamento', val: dataPag },
    { key: 'Multa', val: multa },
    { key: 'Total Recebido', val: total },
    { key: 'Status', val: status },
    { key: 'Observações', val: clean(params.obs) },
  ];
  // procura linha existente (mesmo endereço + competência)
  const addrIdx = sh.headers.indexOf('Endereço'), compIdx = sh.headers.indexOf('Competência');
  const addrCol = await R.readRentalColumn(ssId, sh.title, addrIdx);
  const compCol = await R.readRentalColumn(ssId, sh.title, compIdx);
  let rowNum = 0;
  for (let i = 1; i < Math.max(addrCol.length, compCol.length); i++) {
    if (norm(addrCol[i]) === norm(addr) && clean(compCol[i]) === comp) { rowNum = i + 1; break; }
  }
  if (rowNum) {
    await R.updateRentalCells(ssId, sh.title, rowNum, sh.headers, [{ key: 'Carimbo de data/hora', val: R.nowInTz() }].concat(fields));
    return { ok: true, updated: true, status, multa, total };
  }
  await R.appendRental(ssId, sh.title, R.buildRow(sh.headers, [{ key: 'Carimbo de data/hora', val: R.nowInTz() }].concat(fields)));
  return { ok: true, created: true, status, multa, total };
}

async function deleteRecebimento(params) {
  const { ssId, sh } = await ctx('Recebimentos');
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Registro inválido.' };
  await R.deleteRentalRow(ssId, sh.sheetId, rowNum);
  return { ok: true };
}

// ── CUSTOS (mortgage/água/seguro/outros) ──────────────────
// competência YYYY-MM deslocada em k meses
function addMonthsComp(comp, k) { const [y, m] = comp.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function shiftDateIso(iso, k) { if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1 + k, d); return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }

// lança 1..N custos em meses consecutivos (recorrência de mortgage/seguro)
async function lancarCusto(params) {
  const { ssId, sh } = await ctx('Custos');
  const addr = clean(params.addr);
  const comp = clean(params.competencia);
  if (!addr || !/^\d{4}-\d{2}$/.test(comp)) return { error: 'Casa e competência (YYYY-MM) obrigatórios.' };
  let meses = parseInt(params.meses); if (isNaN(meses) || meses < 1) meses = 1; if (meses > 120) meses = 120;
  const tipo = clean(params.tipo), desc = clean(params.desc), valor = num(params.valor), dataIso = clean(params.dataPagamento), pagador = clean(params.pagador);
  const rows = [];
  for (let k = 0; k < meses; k++) {
    rows.push(R.buildRow(sh.headers, [
      { key: 'Carimbo de data/hora', val: R.nowInTz() },
      { key: 'Endereço', val: addr },
      { key: 'Competência', val: addMonthsComp(comp, k), forceText: true },
      { key: 'Tipo', val: tipo },
      { key: 'Descrição', val: desc },
      { key: 'Valor', val: valor },
      { key: 'Data do Pagamento', val: shiftDateIso(dataIso, k) },
      { key: 'Pagador', val: pagador },
      { key: 'Status Repasse', val: (isAguaTipo(tipo) && ehRepasse(pagador)) ? 'Pendente' : '' },
      { key: 'Data do Repasse', val: '' },
      { key: 'Observações', val: '' },
    ]));
  }
  await R.appendRows(ssId, sh.title, rows);
  return { ok: true, count: rows.length };
}

// ── ÁGUA ──────────────────────────────────────────────────
// A NJR sempre paga a conta à concessionária; o que muda é se o proprietário
// absorve o custo ou repassa ao inquilino. Quando repassa, o reembolso é um
// evento próprio, com status e data separados do pagamento da concessionária.
const isAguaTipo = t => { const n = norm(t); return n === 'água' || n === 'agua'; };
const ehRepasse = p => norm(p) === 'inquilino';

// Lança água em vários meses e/ou várias casas de uma vez (o rateio entre
// unidades do mesmo prédio já vem calculado pela tela).
async function lancarAgua(params) {
  const { ssId, sh } = await ctx('Custos');
  const itens = Array.isArray(params.itens) ? params.itens : [];
  if (!itens.length) return { error: 'Informe ao menos um lançamento.' };
  if (itens.length > 60) return { error: 'Muitos lançamentos de uma vez (máximo 60).' };

  const pagador = clean(params.pagador) || 'Proprietário';
  const repassa = ehRepasse(pagador);
  const pago = repassa && norm(params.statusRepasse) === 'pago';
  const dataRepasse = clean(params.dataRepasse);
  if (pago && !/^\d{4}-\d{2}-\d{2}$/.test(dataRepasse)) {
    return { error: 'Informe a data em que o inquilino pagou.' };
  }
  const dataPagamento = clean(params.dataPagamento);
  const desc = clean(params.desc);

  const linhas = [];
  for (const it of itens) {
    const addr = clean(it.addr);
    const comp = clean(it.competencia);
    const valor = num(it.valor);
    if (!addr) return { error: 'Casa obrigatória em todos os lançamentos.' };
    if (!/^\d{4}-\d{2}$/.test(comp)) return { error: 'Competência inválida (use AAAA-MM) em ' + addr + '.' };
    if (!(valor > 0)) return { error: 'Valor inválido em ' + addr + ' / ' + comp + ' — informe um número maior que zero.' };
    linhas.push(R.buildRow(sh.headers, [
      { key: 'Carimbo de data/hora', val: R.nowInTz() },
      { key: 'Endereço', val: addr },
      { key: 'Competência', val: comp, forceText: true },
      { key: 'Tipo', val: 'Água' },
      { key: 'Descrição', val: desc },
      { key: 'Valor', val: valor },
      { key: 'Data do Pagamento', val: dataPagamento },
      { key: 'Pagador', val: pagador },
      { key: 'Status Repasse', val: repassa ? (pago ? 'Pago' : 'Pendente') : '' },
      { key: 'Data do Repasse', val: pago ? dataRepasse : '' },
      { key: 'Observações', val: '' },
    ]));
  }
  await R.appendRows(ssId, sh.title, linhas);
  return { ok: true, count: linhas.length };
}

// Marca (ou desmarca) o reembolso da água pelo inquilino.
async function marcarRepasseAgua(params) {
  const { ssId, sh } = await ctx('Custos');
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Linha inválida.' };

  const linha = await R.readRentalRow(ssId, sh.title, rowNum, sh.headers);
  if (!linha) return { error: 'Lançamento não encontrado.' };
  if (!isAguaTipo(linha['Tipo'])) return { error: 'Este lançamento não é de água.' };
  if (!ehRepasse(linha['Pagador'])) return { error: 'Esta água é assumida pelo proprietário — não há repasse a cobrar.' };

  const pago = params.pago === true || norm(params.pago) === 'true' || norm(params.pago) === 'sim';
  const data = clean(params.data);
  if (pago && !/^\d{4}-\d{2}-\d{2}$/.test(data)) return { error: 'Informe a data do pagamento (AAAA-MM-DD).' };

  await R.updateRentalCells(ssId, sh.title, rowNum, sh.headers, [
    { key: 'Status Repasse', val: pago ? 'Pago' : 'Pendente' },
    { key: 'Data do Repasse', val: pago ? data : '' },
  ]);
  return { ok: true, pago };
}

async function saveCusto(params) {
  const { ssId, sh } = await ctx('Custos');
  const addr = clean(params.addr);
  const comp = clean(params.competencia);
  if (!addr || !/^\d{4}-\d{2}$/.test(comp)) return { error: 'Endereço e competência (YYYY-MM) obrigatórios.' };
  const fields = [
    { key: 'Endereço', val: addr },
    { key: 'Competência', val: comp, forceText: true },
    { key: 'Tipo', val: clean(params.tipo) },
    { key: 'Descrição', val: clean(params.desc) },
    { key: 'Valor', val: num(params.valor) },
    { key: 'Data do Pagamento', val: clean(params.dataPagamento) },
    { key: 'Pagador', val: clean(params.pagador) },
    { key: 'Observações', val: clean(params.obs) },
  ];
  // água repassada guarda o status do reembolso; assumida pelo proprietário não tem repasse
  if (isAguaTipo(params.tipo) && ehRepasse(params.pagador)) {
    if (params.statusRepasse !== undefined) {
      const pg = norm(params.statusRepasse) === 'pago';
      fields.push({ key: 'Status Repasse', val: pg ? 'Pago' : 'Pendente' });
      fields.push({ key: 'Data do Repasse', val: pg ? clean(params.dataRepasse) : '' });
    }
  } else {
    fields.push({ key: 'Status Repasse', val: '' });
    fields.push({ key: 'Data do Repasse', val: '' });
  }

  const rowNum = parseInt(params.rowNum);
  if (rowNum && rowNum >= 2) {
    await R.updateRentalCells(ssId, sh.title, rowNum, sh.headers, [{ key: 'Carimbo de data/hora', val: R.nowInTz() }].concat(fields));
    return { ok: true, updated: true };
  }
  await R.appendRental(ssId, sh.title, R.buildRow(sh.headers, [{ key: 'Carimbo de data/hora', val: R.nowInTz() }].concat(fields)));
  return { ok: true, created: true };
}

async function deleteCusto(params) {
  const { ssId, sh } = await ctx('Custos');
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Registro inválido.' };
  await R.deleteRentalRow(ssId, sh.sheetId, rowNum);
  return { ok: true };
}

// ── MANUTENÇÃO ────────────────────────────────────────────
async function saveManutencao(params) {
  const { ssId, sh } = await ctx('Manutenção');
  const addr = clean(params.addr);
  if (!addr) return { error: 'Endereço obrigatório.' };
  const dataCon = clean(params.dataConclusao);
  const comp = clean(params.competencia) || (dataCon.match(/^(\d{4})-(\d{2})/) ? dataCon.slice(0, 7) : '');
  const fields = [
    { key: 'Endereço', val: addr },
    { key: 'Data de Conclusão', val: dataCon },
    { key: 'Competência', val: comp, forceText: true },
    { key: 'Tipo de Serviço', val: clean(params.tipo) },
    { key: 'Descrição do Serviço', val: clean(params.desc) },
    { key: 'Empresa Subcontratada', val: clean(params.empresa) },
    { key: 'Contato do Subcontratado', val: clean(params.contato), forceText: true },
    { key: 'Valor do Serviço', val: num(params.valor) },
    { key: 'Status Pagamento', val: clean(params.status) },
    { key: 'Anexar Invoice', val: clean(params.invoiceUrl) },
  ];
  const rowNum = parseInt(params.rowNum);
  if (rowNum && rowNum >= 2) {
    await R.updateRentalCells(ssId, sh.title, rowNum, sh.headers, [{ key: 'Carimbo de data/hora', val: R.nowInTz() }].concat(fields));
    return { ok: true, updated: true };
  }
  await R.appendRental(ssId, sh.title, R.buildRow(sh.headers, [{ key: 'Carimbo de data/hora', val: R.nowInTz() }].concat(fields)));
  return { ok: true, created: true };
}

async function deleteManutencao(params) {
  const { ssId, sh } = await ctx('Manutenção');
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Registro inválido.' };
  await R.deleteRentalRow(ssId, sh.sheetId, rowNum);
  return { ok: true };
}

// ── DRIVE (invoices de manutenção) ────────────────────────
async function findOrCreateFolder(drive, name, parentId) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false${parentClause}`,
    fields: 'files(id)', spaces: 'drive', pageSize: 1,
  });
  if (res.data.files && res.data.files.length) return res.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }, fields: 'id',
  });
  return created.data.id;
}
async function getDocsFolder(params) {
  const addr = clean(params.addr);
  if (!addr) return { error: 'Endereço obrigatório.' };
  const sub = clean(params.subfolder) || 'Invoices';
  const drive = driveApi();
  const rootId = await findOrCreateFolder(drive, R.DOCS_FOLDER, null);
  const safe = addr.replace(/[\/\\:*?"<>|]/g, '-').substring(0, 100);
  const casaId = await findOrCreateFolder(drive, safe, rootId);
  const subId = await findOrCreateFolder(drive, sub, casaId);
  try { await drive.permissions.create({ fileId: subId, requestBody: { role: 'reader', type: 'anyone' } }); } catch (_) {}
  return { ok: true, id: subId, url: `https://drive.google.com/drive/folders/${subId}` };
}

module.exports = {
  saveCasa, deleteCasa, reorderCasas, removerInquilino,
  markRecebido, deleteRecebimento,
  saveCusto, lancarCusto, deleteCusto, lancarAgua, marcarRepasseAgua,
  saveManutencao, deleteManutencao,
  getDocsFolder, uploadFile,
};
