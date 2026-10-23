// ============================================================
// NJR Bathrooms — lista de interessados no curso Schluter-Systems
// (formulário PÚBLICO em /curso-schluter). Arquivo com underscore: NÃO vira
// função serverless (limite de 12 no plano Hobby) — é despachado pelo
// api/write.js.
//
// O link é postado em grupos e redes, então a chave (?key=) NÃO é segredo:
// ela só serve para desligar o link (trocar CURSO_KEY_VERSION → o link antigo
// passa a mostrar "inscrições encerradas") e para barrar varredura cega. A
// proteção de verdade fica aqui:
//   - a página só GRAVA — nenhuma resposta devolve dado de inscrito nem contagem;
//   - validação e tamanho máximo de cada campo no servidor;
//   - honeypot + tempo mínimo de preenchimento (robô recebe "ok" e nada é gravado);
//   - limite por IP (memória da lambda quente: não é global, mas segura rajada);
//   - mesmo telefone ou e-mail não duplica linha — e a resposta é a mesma de um
//     cadastro novo, para o formulário não servir de consulta "fulano está na lista?";
//   - teto de linhas na aba;
//   - todo texto vai com apóstrofo (forceText): "=..." ou "+1..." nunca vira fórmula.
// ============================================================

const crypto = require('crypto');
const G = require('./_google');

const CURSO_SHEET = 'Curso Schluter';
// Empresa entrou depois (opcional) — fica no fim para valer igual em aba nova e em aba já criada
const CURSO_HEADERS = ['Carimbo de data/hora', 'Nome', 'Telefone', 'E-mail', 'Empresa'];
const CURSO_KEY_VERSION = 'njr-curso-schluter-v1';
const CURSO_TZ = 'America/New_York'; // o curso é em Boston
const MAX_LINHAS = 1500;
const MIN_MS_PREENCHER = 1500;

function cursoKey() {
  const secret = process.env.JWT_SECRET || 'njr';
  return crypto.createHmac('sha256', secret).update(CURSO_KEY_VERSION).digest('hex').slice(0, 16);
}

function checkCursoKey(key) {
  if (typeof key !== 'string' || !key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(cursoKey());
  // timingSafeEqual lança erro com tamanhos diferentes — checa antes
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// URL do formulário — sempre o domínio de produção (igual ao subFormUrl)
function cursoUrl(origin) {
  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = prodHost ? ('https://' + prodHost) : String(origin || '').replace(/\/+$/, '');
  if (!base) return null;
  return base + '/curso-schluter?key=' + cursoKey();
}

// ── limite por IP ─────────────────────────────────────────
const JANELA_MS = 10 * 60 * 1000;
const MAX_POR_IP = 6;
const HITS = new Map();
function excedeuLimite(ip) {
  const agora = Date.now();
  const lista = (HITS.get(ip) || []).filter(t => agora - t < JANELA_MS);
  if (lista.length >= MAX_POR_IP) { HITS.set(ip, lista); return true; }
  lista.push(agora);
  HITS.set(ip, lista);
  if (HITS.size > 5000) HITS.clear(); // não deixa a memória crescer sem fim
  return false;
}

// ── validação ─────────────────────────────────────────────
function limpa(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const digitos = s => String(s || '').replace(/\D/g, '');

// (617) 555-0100 para número dos EUA; qualquer outro (ex.: +55…) fica como digitado
function formataTelefone(raw) {
  const d = digitos(raw);
  if (d.length === 10) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  if (d.length === 11 && d[0] === '1') return '(' + d.slice(1, 4) + ') ' + d.slice(4, 7) + '-' + d.slice(7);
  return limpa(raw, 25);
}

// chave de comparação: últimos 10 dígitos (ignora +1 / 1 / formatação)
const chaveTel = s => digitos(s).slice(-10);

function valida(b) {
  const nome = limpa(b.nome, 80);
  const telRaw = limpa(b.telefone, 25);
  const email = limpa(b.email, 120).toLowerCase();
  const empresa = limpa(b.empresa, 100); // opcional
  // começa com letra: além de ser nome de verdade, impede "=fórmula" na planilha e no CSV
  if (nome.length < 3 || !/^\p{L}/u.test(nome) || /[<>]/.test(nome)) return { error: 'Informe seu nome completo. / Please enter your full name.' };
  const nd = digitos(telRaw).length;
  if (nd < 10 || nd > 15 || /[^\d\s()+.\-]/.test(telRaw)) return { error: 'Informe um telefone válido, com DDD. / Please enter a valid phone number.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Informe um e-mail válido. / Please enter a valid email.' };
  if (/[<>]/.test(empresa)) return { error: 'Nome da empresa inválido. / Invalid company name.' };
  return { nome, telefone: formataTelefone(telRaw), email, empresa };
}

// ── planilha ──────────────────────────────────────────────
// Lê a aba inteira numa chamada só (cabeçalho + linhas). null = aba ainda não existe.
async function lerAba() {
  try {
    const r = await G.sheetsApi().spreadsheets.values.get({
      spreadsheetId: G.SPREADSHEET_ID,
      range: G.q(CURSO_SHEET),
      valueRenderOption: 'FORMATTED_VALUE',
    });
    return r.data.values || [];
  } catch (e) {
    if (/unable to parse range/i.test(String(e.message))) return null;
    throw e;
  }
}

async function criaAba() {
  const sheets = G.sheetsApi();
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: G.SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: CURSO_SHEET, gridProperties: { frozenRowCount: 1 } } } }] },
    });
  } catch (e) {
    // dois primeiros envios ao mesmo tempo: o segundo encontra a aba já criada
    if (!/already exists/i.test(String(e.message))) throw e;
    return;
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: G.SPREADSHEET_ID,
    range: G.q(CURSO_SHEET) + '!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [CURSO_HEADERS] },
  });
}

// chamado pelo endpoint PÚBLICO após validar a chave do link
async function cursoInscrever(b, ip) {
  // robô: preencheu o campo invisível ou enviou rápido demais — finge sucesso
  if (String(b.site || '').trim()) return { ok: true };
  const ms = Number(b.ms);
  if (!(ms >= MIN_MS_PREENCHER)) return { ok: true };

  if (excedeuLimite(ip || '?')) {
    return { error: 'Muitos envios seguidos. Aguarde alguns minutos e tente de novo. / Too many attempts — please wait a few minutes.' };
  }

  const v = valida(b);
  if (v.error) return v;

  let valores = await lerAba();
  if (valores === null) { await criaAba(); valores = [CURSO_HEADERS]; }
  const headers = (valores[0] && valores[0].length ? valores[0] : CURSO_HEADERS).map(h => String(h).trim());
  const linhas = valores.slice(1);

  const iTel = headers.indexOf('Telefone');
  const iMail = headers.indexOf('E-mail');
  const tel = chaveTel(v.telefone);
  const repetido = linhas.some(r =>
    (iTel >= 0 && tel && chaveTel(r[iTel]) === tel) ||
    (iMail >= 0 && String(r[iMail] || '').trim().toLowerCase() === v.email));
  if (repetido) return { ok: true };

  if (linhas.length >= MAX_LINHAS) {
    return { error: 'A lista atingiu o limite. Fale direto com a NJR Bathrooms. / The list is full — please contact NJR Bathrooms.' };
  }

  // aba criada antes do campo Empresa: acrescenta a coluna no fim, sem mexer nas existentes
  if (!headers.includes('Empresa')) {
    await G.sheetsApi().spreadsheets.values.update({
      spreadsheetId: G.SPREADSHEET_ID,
      range: G.q(CURSO_SHEET) + '!' + G.colLetter(headers.length) + '1',
      valueInputOption: 'RAW',
      requestBody: { values: [['Empresa']] },
    });
    headers.push('Empresa');
  }

  const row = G.buildRow(headers, [
    { key: 'Carimbo de data/hora', val: G.nowInTz(CURSO_TZ) },
    { key: 'Nome', val: v.nome, forceText: true },
    { key: 'Telefone', val: v.telefone, forceText: true },
    { key: 'E-mail', val: v.email, forceText: true },
    { key: 'Empresa', val: v.empresa, forceText: true },
  ]);
  await G.appendRow(CURSO_SHEET, row);
  return { ok: true };
}

// ── ações do painel (com login) ───────────────────────────
async function getCursoLink(params) {
  const url = cursoUrl(params.origin);
  if (!url) return { error: 'URL do site indisponível.' };
  return { ok: true, url };
}

async function deleteCursoInscrito(params) {
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Linha inválida.' };
  const { index } = await G.loadSheetIndex();
  const sh = index.find(s => s.title === CURSO_SHEET);
  if (!sh) return { error: 'Aba "' + CURSO_SHEET + '" não encontrada.' };
  // novos cadastros entram enquanto o painel está aberto: confere que a linha
  // ainda é a mesma pessoa antes de apagar
  if (params.telefone !== undefined) {
    const iTel = sh.headers.indexOf('Telefone');
    const atual = iTel >= 0 ? (await G.readColumn(CURSO_SHEET, iTel, rowNum))[rowNum - 1] : undefined;
    if (iTel >= 0 && chaveTel(atual) !== chaveTel(params.telefone)) {
      return { error: 'A lista mudou desde que a tela foi aberta. Atualize a página e tente de novo.' };
    }
  }
  await G.deleteRow(sh.sheetId, rowNum);
  return { ok: true };
}

module.exports = {
  CURSO_SHEET, CURSO_HEADERS, cursoKey, checkCursoKey, cursoUrl, valida, formataTelefone,
  cursoInscrever, getCursoLink, deleteCursoInscrito,
};
