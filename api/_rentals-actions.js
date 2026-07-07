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
    { key: 'Observações', val: clean(params.obs) },
  ];
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
  saveCasa, deleteCasa, reorderCasas,
  markRecebido, deleteRecebimento,
  saveCusto, deleteCusto,
  saveManutencao, deleteManutencao,
  getDocsFolder, uploadFile,
};
