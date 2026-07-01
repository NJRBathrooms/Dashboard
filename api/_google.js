// ============================================================
// NJR Bathrooms — acesso direto à Google Sheets API v4 + Drive API v3
// Substitui o Google Apps Script (que tinha piso de 2-5s por chamada).
// Autentica como o DONO da conta via OAuth refresh token, então tudo
// (planilha + fotos no Drive) aparece na conta dele, igual ao Apps Script,
// porém em ~0,3-0,6s em vez de 6-10s.
// ============================================================

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1D0D1GrvL6Zk2e5qv1cI7cEAHzxTKRLrBjxg3SgCcUzg';
const DEFAULT_TZ = 'America/Sao_Paulo';

// ── AUTENTICAÇÃO ──────────────────────────────────────────
// Reutiliza o mesmo OAuth2 client enquanto a lambda estiver quente.
// googleapis cuida de trocar o refresh_token por access_token e renová-lo.
let _auth = null;
function getAuth() {
  if (_auth) return _auth;
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_REFRESH_TOKEN;
  if (!id || !secret || !refresh) {
    throw new Error('Credenciais Google ausentes. Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REFRESH_TOKEN na Vercel.');
  }
  const oauth2 = new google.auth.OAuth2(id, secret);
  oauth2.setCredentials({ refresh_token: refresh });
  _auth = oauth2;
  return _auth;
}

let _sheets = null, _drive = null, _gmail = null;
function sheetsApi() { return _sheets || (_sheets = google.sheets({ version: 'v4', auth: getAuth() })); }
function driveApi()  { return _drive  || (_drive  = google.drive({ version: 'v3', auth: getAuth() })); }
function gmailApi()  { return _gmail  || (_gmail  = google.gmail({ version: 'v1', auth: getAuth() })); }

// Envia e-mail como o dono da conta, via Gmail API (escopo gmail.send).
// Passe html=true para enviar corpo em HTML (negrito/emojis renderizam).
async function sendEmail(to, subject, body, html) {
  const subjectEnc = '=?UTF-8?B?' + Buffer.from(String(subject), 'utf8').toString('base64') + '?=';
  const ctype = html ? 'text/html' : 'text/plain';
  const msg = [
    `To: ${to}`,
    `Subject: ${subjectEnc}`,
    'MIME-Version: 1.0',
    `Content-Type: ${ctype}; charset="UTF-8"`,
    'Content-Transfer-Encoding: 8bit',
    '',
    String(body),
  ].join('\r\n');
  const raw = Buffer.from(msg, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await gmailApi().users.messages.send({ userId: 'me', requestBody: { raw } });
}

// Data/hora atual amigável (dd/MM/yyyy HH:mm) no fuso da planilha
function nowFriendly(tz) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || DEFAULT_TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value;
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

// ── DATAS (serial do Sheets → string, replicando o Apps Script) ──
// Lemos os valores como UNFORMATTED_VALUE: números continuam números (bom p/ valores),
// e datas vêm como "serial" (dias desde 1899-12-30). Convertemos só as colunas de data.
function isDateHeader(h) {
  const s = String(h).toLowerCase();
  return s.includes('carimbo') || s.includes('hora') || s.includes('data') || s.includes('conclus')
      || s.includes('contrato') || s.includes('vig'); // datas do app de aluguel (Início/Fim do Contrato, Vigência do Seguro)
}
function fmtSerial(serial) {
  // serial 0 = 1899-12-30. Unix epoch = serial 25569. Lemos como "relógio de parede" via UTC.
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  // Apps Script: ano <= 1900 (valor só de hora) → "HH:mm:ss"; senão "yyyy/MM/dd HH:mm:ss"
  if (d.getUTCFullYear() <= 1900) return time;
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${time}`;
}

// Converte a matriz de valores (linhas) em objetos {header: valor, _row: nºlinhaReal},
// replicando getSheetData() do Apps Script: dedup de cabeçalho repetido (mantém 1º não-vazio),
// _row = nº real da linha na planilha, e descarta linhas totalmente vazias.
function rowsToObjects(values, maxCols) {
  if (!values || values.length < 2) return [];
  let headers = (values[0] || []).map(h => String(h).trim());
  if (maxCols) headers = headers.slice(0, maxCols);
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    const obj = { _row: r + 1 }; // values[1] = linha 2 da planilha
    headers.forEach((h, i) => {
      if (!h) return;
      let val = row[i];
      if (val === undefined || val === null) val = '';
      if (typeof val === 'number' && isDateHeader(h)) val = fmtSerial(val);
      if (!(h in obj)) {
        obj[h] = val;
      } else if ((obj[h] === '' || obj[h] === null || obj[h] === undefined) && val !== '' && val !== null && val !== undefined) {
        obj[h] = val;
      }
    });
    const hasData = Object.keys(obj).some(k => k !== '_row' && obj[k] !== '' && obj[k] !== null && obj[k] !== undefined);
    if (hasData) out.push(obj);
  }
  return out;
}

// ── LEITURA ───────────────────────────────────────────────
function q(title) { return `'${String(title).replace(/'/g, "''")}'`; }

// Lê os títulos das abas + timezone numa chamada, depois todos os valores num batchGet.
async function readWorkbook() {
  const sheets = sheetsApi();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'properties.timeZone,sheets.properties.title',
  });
  const tz = (meta.data.properties && meta.data.properties.timeZone) || DEFAULT_TZ;
  const titles = meta.data.sheets.map(s => s.properties.title);
  const resp = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: titles.map(q),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  const byTitle = {};
  titles.forEach((t, i) => { byTitle[t] = (resp.data.valueRanges[i] && resp.data.valueRanges[i].values) || []; });
  return { tz, titles, byTitle };
}

// Acha a aba cujos cabeçalhos contêm todas as palavras-chave (replicando findSheet).
function findValues(byTitle, keywords) {
  const low = keywords.map(k => k.toLowerCase());
  for (const title of Object.keys(byTitle)) {
    const headers = (byTitle[title][0] || []).map(h => String(h).toLowerCase());
    if (low.every(kw => headers.some(h => h.includes(kw)))) return byTitle[title];
  }
  return null;
}

// readAll completo (igual ao do dashboard)
async function readAll() {
  const { byTitle } = await readWorkbook();
  const labor = findValues(byTitle, ['nome do funcionário', 'hora de entrada']);
  const mats  = findValues(byTitle, ['data da compra', 'descrição dos itens']);
  const subs  = findValues(byTitle, ['empresa subcontratada', 'valor do serviço']);
  const obras = findValues(byTitle, ['nome do cliente', 'orçamento']);
  const cli   = findValues(byTitle, ['contato do cliente', 'email do cliente']);
  const ajus  = findValues(byTitle, ['semana', 'bonifica']);
  return {
    labor:          labor ? rowsToObjects(labor)     : [],
    materials:      mats  ? rowsToObjects(mats)      : [],
    subcontractors: subs  ? rowsToObjects(subs, 11)  : [],
    obras:          obras ? rowsToObjects(obras)     : [],
    clients:        cli   ? rowsToObjects(cli)       : [],
    ajustes:        ajus  ? rowsToObjects(ajus)      : [],
    lastUpdated:    new Date().toISOString(),
  };
}

// Cria uma aba nova com a linha de cabeçalho (se ainda não existir).
async function createSheet(title, headers) {
  const sheets = sheetsApi();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${q(title)}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
}

// Versão enxuta p/ o app de funcionário (labor + obras + ajustes)
async function readEmpData() {
  const { byTitle } = await readWorkbook();
  const labor = findValues(byTitle, ['nome do funcionário', 'hora de entrada']);
  const obras = findValues(byTitle, ['nome do cliente', 'orçamento']);
  const ajus  = findValues(byTitle, ['semana', 'bonifica']);
  return {
    labor:       labor ? rowsToObjects(labor) : [],
    obras:       obras ? rowsToObjects(obras) : [],
    ajustes:     ajus  ? rowsToObjects(ajus)  : [],
    lastUpdated: new Date().toISOString(),
  };
}

// Credenciais de funcionário (aba "Funcionários" com colunas Nome/Senha)
async function readEmpCredentials() {
  const { byTitle } = await readWorkbook();
  const vals = findValues(byTitle, ['nome', 'senha']);
  if (!vals) return [];
  return rowsToObjects(vals)
    .map(r => ({ nome: String(r['Nome'] || '').trim(), senha: String(r['Senha'] || '').trim() }))
    .filter(c => c.nome && c.senha);
}

// ── ESCRITA — utilidades ──────────────────────────────────
// Índice de abas com cabeçalhos (1 metadata + 1 batchGet das linhas de cabeçalho).
async function loadSheetIndex() {
  const sheets = sheetsApi();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'properties.timeZone,sheets.properties(title,sheetId)',
  });
  const tz = (meta.data.properties && meta.data.properties.timeZone) || DEFAULT_TZ;
  const props = meta.data.sheets.map(s => s.properties);
  const ranges = props.map(p => `${q(p.title)}!1:1`);
  const hr = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID, ranges, valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const index = props.map((p, i) => ({
    title: p.title,
    sheetId: p.sheetId,
    headers: (((hr.data.valueRanges[i] || {}).values || [[]])[0] || []).map(h => String(h).trim()),
  }));
  return { tz, index };
}
function findSheetEntry(index, keywords) {
  const low = keywords.map(k => k.toLowerCase());
  return index.find(s => low.every(kw => s.headers.some(h => h.toLowerCase().includes(kw)))) || null;
}

// "agora" formatado em yyyy-MM-dd HH:mm:ss no fuso da planilha (USER_ENTERED vira data real)
function nowInTz(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || DEFAULT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = t => (parts.find(p => p.type === t) || {}).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

function colLetter(idx0) { // 0 -> A, 25 -> Z, 26 -> AA
  let n = idx0, s = '';
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

// Monta uma linha (array) a partir de um objeto {header: valor}, na ordem dos cabeçalhos.
// Campos de telefone/contato recebem apóstrofo para forçar texto (evita "+" virar fórmula).
function buildRow(headers, mapping) {
  const row = new Array(headers.length).fill('');
  const setByExact = (name, val) => { const i = headers.indexOf(name); if (i >= 0) row[i] = val; };
  const setByFuzzy = (term, val) => {
    const i = headers.findIndex(h => h.toLowerCase().includes(term.toLowerCase()));
    if (i >= 0) row[i] = val;
  };
  for (const m of mapping) {
    if (m.val === undefined) continue;
    let v = m.val;
    if (m.forceText && v !== '' && v !== null && v !== undefined) v = "'" + String(v); // texto literal
    if (m.fuzzy) setByFuzzy(m.key, v); else setByExact(m.key, v);
  }
  return row;
}

async function appendRow(title, row) {
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: q(title),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

async function updateCell(title, rowNum, colIdx0, value) {
  await sheetsApi().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${q(title)}!${colLetter(colIdx0)}${rowNum}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });
}

// Atualiza várias células da mesma linha numa só chamada (batchUpdate de valores).
async function updateRowCells(title, rowNum, headers, updates) {
  const data = [];
  for (const u of updates) {
    let idx = u.fuzzy
      ? headers.findIndex(h => h.toLowerCase().includes(u.key.toLowerCase()))
      : headers.indexOf(u.key);
    if (idx < 0) continue;
    let v = u.val;
    if (u.forceText && v !== '' && v !== null && v !== undefined) v = "'" + String(v);
    data.push({ range: `${q(title)}!${colLetter(idx)}${rowNum}`, values: [[v]] });
  }
  if (!data.length) return;
  await sheetsApi().spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
}

async function deleteRow(sheetId, rowNum) {
  await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowNum - 1, endIndex: rowNum },
        },
      }],
    },
  });
}

// Lê uma coluna inteira (valores) de uma aba — usado para localizar linha por endereço.
async function readColumn(title, colIdx0, lastRow) {
  const col = colLetter(colIdx0);
  const resp = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${q(title)}!${col}1:${col}${lastRow || ''}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return (resp.data.values || []).map(r => (r[0] !== undefined ? r[0] : ''));
}

function normStr(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

module.exports = {
  SPREADSHEET_ID,
  sheetsApi, driveApi, gmailApi, sendEmail, nowFriendly,
  readAll, readEmpData, readEmpCredentials, readWorkbook, findValues, rowsToObjects,
  loadSheetIndex, findSheetEntry, createSheet, nowInTz, colLetter, buildRow,
  appendRow, updateCell, updateRowCells, deleteRow, readColumn, normStr, q,
};
