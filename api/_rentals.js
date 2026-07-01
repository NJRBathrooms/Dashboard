// ============================================================
// NJR Casas de Aluguel — base de dados própria (planilha + pasta no Drive)
// Criada automaticamente na conta admnjrbathrooms via API. Reutiliza a
// autenticação/os helpers do _google.js. Isolada do NJR Bathrooms.
// ============================================================

const { sheetsApi, driveApi, rowsToObjects, buildRow, colLetter, nowInTz, q } = require('./_google');

const SS_NAME = 'NJR Casas de Aluguel - Base de Dados';
const DOCS_FOLDER = 'NJR Casas de Aluguel - Documentos';

// Esquema das abas (título → cabeçalhos)
const TABS = {
  Casas: ['Carimbo de data/hora','Endereço','Inquilino','Contato do Inquilino','Status','Aluguel Mensal','Security Deposit','Início do Contrato','Fim do Contrato','Seguradora','Vigência do Seguro','Valor do Seguro','Periodicidade do Seguro','Mortgage Mensal','Valor da Água','Periodicidade da Água','Observações'],
  Recebimentos: ['Carimbo de data/hora','Endereço','Competência','Valor do Aluguel','Data do Pagamento','Multa','Total Recebido','Status','Observações'],
  Custos: ['Carimbo de data/hora','Endereço','Competência','Tipo','Descrição','Valor','Data do Pagamento','Observações'],
  Manutenção: ['Carimbo de data/hora','Endereço','Data de Conclusão','Competência','Tipo de Serviço','Descrição do Serviço','Empresa Subcontratada','Contato do Subcontratado','Valor do Serviço','Status Pagamento','Anexar Invoice'],
  Alertas: ['Tipo','Endereço','Marco','Enviado em'],
};

// Casas iniciais pré-cadastradas (o usuário edita/completa e pode incluir novas)
const SEED_CASAS = [
  '24 Whitman St, Leominster MA',
  '26 Whitman St, Leominster MA',
  '15 Foch Ave, Fitchburg MA (downstairs)',
  '15 Foch Ave, Fitchburg MA (upstairs)',
  '79 Appleton Cir, Fitchburg MA',
  '85 Edward St, Fitchburg MA',
];

let _ssId = null;

// ── Localiza ou cria a planilha da base de dados ──────────────
async function getRentalsSS() {
  if (_ssId) return _ssId;
  const drive = driveApi();
  const res = await drive.files.list({
    q: `name='${SS_NAME.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id)', spaces: 'drive', pageSize: 1,
  });
  if (res.data.files && res.data.files.length) {
    _ssId = res.data.files[0].id;
    await ensureTabs(_ssId);
    return _ssId;
  }
  // criar planilha com todas as abas
  const created = await sheetsApi().spreadsheets.create({
    requestBody: {
      properties: { title: SS_NAME },
      sheets: Object.keys(TABS).map(title => ({ properties: { title } })),
    },
    fields: 'spreadsheetId',
  });
  _ssId = created.data.spreadsheetId;
  // escrever cabeçalhos
  const data = Object.entries(TABS).map(([title, headers]) => ({ range: `${q(title)}!A1`, values: [headers] }));
  await sheetsApi().spreadsheets.values.batchUpdate({
    spreadsheetId: _ssId, requestBody: { valueInputOption: 'RAW', data },
  });
  // pré-cadastrar as casas iniciais (só endereço + status Vacância)
  const casaHeaders = TABS.Casas;
  const seedRows = SEED_CASAS.map(addr => {
    const row = new Array(casaHeaders.length).fill('');
    row[casaHeaders.indexOf('Endereço')] = addr;
    row[casaHeaders.indexOf('Status')] = 'Vacância';
    return row;
  });
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId: _ssId, range: q('Casas'), valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS', requestBody: { values: seedRows },
  });
  return _ssId;
}

// Garante que todas as abas do esquema existem (com cabeçalho). Evolução de schema segura.
async function ensureTabs(ssId) {
  const meta = await sheetsApi().spreadsheets.get({ spreadsheetId: ssId, fields: 'sheets.properties.title' });
  const existing = new Set(meta.data.sheets.map(s => s.properties.title));
  const missing = Object.keys(TABS).filter(t => !existing.has(t));
  if (!missing.length) return;
  await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId: ssId,
    requestBody: { requests: missing.map(title => ({ addSheet: { properties: { title } } })) },
  });
  const data = missing.map(title => ({ range: `${q(title)}!A1`, values: [TABS[title]] }));
  await sheetsApi().spreadsheets.values.batchUpdate({
    spreadsheetId: ssId, requestBody: { valueInputOption: 'RAW', data },
  });
}

// ── Leitura ───────────────────────────────────────────────
async function readAllRentals() {
  const ssId = await getRentalsSS();
  const titles = Object.keys(TABS);
  const resp = await sheetsApi().spreadsheets.values.batchGet({
    spreadsheetId: ssId,
    ranges: titles.map(q),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  const out = {};
  titles.forEach((t, i) => {
    const vals = (resp.data.valueRanges[i] && resp.data.valueRanges[i].values) || [];
    out[t] = rowsToObjects(vals);
  });
  return {
    casas: out.Casas || [],
    recebimentos: out.Recebimentos || [],
    custos: out.Custos || [],
    manutencao: out['Manutenção'] || [],
    alertas: out.Alertas || [],
    lastUpdated: new Date().toISOString(),
  };
}

// ── Escrita (helpers parametrizados pela planilha de aluguel) ──
async function loadRentalIndex(ssId) {
  const meta = await sheetsApi().spreadsheets.get({ spreadsheetId: ssId, fields: 'sheets.properties(title,sheetId)' });
  const props = meta.data.sheets.map(s => s.properties);
  const ranges = props.map(p => `${q(p.title)}!1:1`);
  const hr = await sheetsApi().spreadsheets.values.batchGet({ spreadsheetId: ssId, ranges, valueRenderOption: 'UNFORMATTED_VALUE' });
  return props.map((p, i) => ({
    title: p.title, sheetId: p.sheetId,
    headers: (((hr.data.valueRanges[i] || {}).values || [[]])[0] || []).map(h => String(h).trim()),
  }));
}

async function appendRental(ssId, title, row) {
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId: ssId, range: q(title), valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] },
  });
}

async function updateRentalCells(ssId, title, rowNum, headers, updates) {
  const data = [];
  for (const u of updates) {
    let idx = u.fuzzy ? headers.findIndex(h => h.toLowerCase().includes(u.key.toLowerCase())) : headers.indexOf(u.key);
    if (idx < 0) continue;
    let v = u.val;
    if (u.forceText && v !== '' && v != null) v = "'" + String(v);
    data.push({ range: `${q(title)}!${colLetter(idx)}${rowNum}`, values: [[v]] });
  }
  if (!data.length) return;
  await sheetsApi().spreadsheets.values.batchUpdate({
    spreadsheetId: ssId, requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
}

async function deleteRentalRow(ssId, sheetId, rowNum) {
  await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId: ssId,
    requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowNum - 1, endIndex: rowNum } } }] },
  });
}

async function readRentalColumn(ssId, title, colIdx0) {
  const col = colLetter(colIdx0);
  const resp = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: ssId, range: `${q(title)}!${col}1:${col}`, valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return (resp.data.values || []).map(r => (r[0] !== undefined ? r[0] : ''));
}

module.exports = {
  TABS, getRentalsSS, ensureTabs, readAllRentals,
  loadRentalIndex, appendRental, updateRentalCells, deleteRentalRow, readRentalColumn,
  buildRow, nowInTz, DOCS_FOLDER,
};
