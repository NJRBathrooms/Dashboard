// Formulário público do curso Schluter (api/_curso.js + despacho no api/write.js)
// contra uma planilha simulada em memória.
//
// O link é postado em grupos, então o que importa aqui é:
//   - chave errada nunca grava; ação de painel sem login nunca responde;
//   - nada do que a pessoa digita vira fórmula na planilha;
//   - robô (honeypot / envio instantâneo) recebe "ok" e não grava;
//   - o mesmo telefone ou e-mail não duplica — e a resposta é igual à de um cadastro novo;
//   - limite por IP e teto de linhas seguram enxurrada;
//   - erro interno não vaza para quem preenche.
//
// Rodar: node scripts/test-curso.js
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.VERCEL_PROJECT_PRODUCTION_URL = 'njr.example.app';

// ── planilha em memória ──────────────────────────────────
let SHEETS, apagadas, falharLeitura;
function reset() {
  SHEETS = { 'Cadastro de Obras': [['Endereço', 'Nome do Cliente', 'Orçamento']] };
  apagadas = [];
  falharLeitura = false;
}
reset();
const SHEET_IDS = { 'Cadastro de Obras': 1, 'Curso Schluter': 77 };
const semApostrofo = v => (typeof v === 'string' && v[0] === "'" ? v.slice(1) : v);

const gp = path.join(ROOT, 'api', '_google.js');
require.cache[require.resolve(gp)] = { id: gp, filename: gp, loaded: true, exports: {
  SPREADSHEET_ID: 'teste',
  q: t => `'${String(t).replace(/'/g, "''")}'`,
  colLetter: i => String.fromCharCode(65 + i),
  normStr: s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' '),
  nowInTz: () => '2026-10-23 10:00:00',
  sheetsApi: () => ({ spreadsheets: {
    values: {
      get: async ({ range }) => {
        if (falharLeitura) throw new Error('quota exceeded for project 123 user adminnjr');
        const title = range.replace(/^'|'(!.*)?$/g, '').replace(/''/g, "'");
        if (!SHEETS[title]) throw new Error('Unable to parse range: ' + range);
        // o Sheets devolve o texto sem o apóstrofo do forceText
        return { data: { values: SHEETS[title].map(r => r.map(semApostrofo)) } };
      },
      // escreve a partir da célula do range (A1 = cabeçalho novo; E1 = coluna acrescentada)
      update: async ({ range, requestBody }) => {
        const m = /^'(.*)'!([A-Z])(\d+)$/.exec(range);
        const row = SHEETS[m[1]][+m[3] - 1];
        requestBody.values[0].forEach((v, k) => { row[m[2].charCodeAt(0) - 65 + k] = v; });
      },
    },
    batchUpdate: async ({ requestBody }) => {
      const t = requestBody.requests[0].addSheet.properties.title;
      if (SHEETS[t]) throw new Error('A sheet with the name "' + t + '" already exists.');
      SHEETS[t] = [[]];
    },
  } }),
  buildRow: (headers, mapping) => {
    const row = new Array(headers.length).fill('');
    for (const m of mapping) {
      const i = headers.indexOf(m.key);
      if (i >= 0) row[i] = m.forceText && m.val !== '' ? "'" + m.val : m.val;
    }
    return row;
  },
  appendRow: async (title, row) => { SHEETS[title].push(row.slice()); },
  loadSheetIndex: async () => ({ index: Object.keys(SHEETS).map(title => ({
    title, sheetId: SHEET_IDS[title], headers: (SHEETS[title][0] || []).map(String),
  })) }),
  readColumn: async (title, idx, lastRow) => SHEETS[title].slice(0, lastRow).map(r => semApostrofo(r[idx] === undefined ? '' : r[idx])),
  deleteRow: async (sheetId, rowNum) => {
    apagadas.push(rowNum);
    const t = Object.keys(SHEET_IDS).find(k => SHEET_IDS[k] === sheetId);
    SHEETS[t].splice(rowNum - 1, 1);
  },
} };
// write.js também carrega os módulos do painel — só precisam existir
for (const f of ['_actions.js', '_crm.js', '_drive.js']) {
  const p = path.join(ROOT, 'api', f);
  require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports: {} };
}

const C = require(path.join(ROOT, 'api', '_curso.js'));
const write = require(path.join(ROOT, 'api', 'write.js'));

let fails = 0;
const ok = t => console.log('  ok  ' + t);
const bad = (t, d) => { fails++; console.log('  FALHOU  ' + t + (d ? '\n          ' + d : '')); };
const check = (t, cond, d) => (cond ? ok(t) : bad(t, d));
async function roda(t, fn) {
  try { const r = await fn(); if (r === true) ok(t); else bad(t, r); }
  catch (e) { bad(t, 'lançou: ' + e.message); }
}

const KEY = C.cursoKey();
const linhas = () => (SHEETS['Curso Schluter'] || [[]]).slice(1);
let ipSeq = 0;
const pessoa = (o = {}) => Object.assign({ nome: 'Carlos Souza', telefone: '617-555-0100', email: 'carlos@x.com', site: '', ms: 9000 }, o);
const inscreve = (o, ip) => C.cursoInscrever(pessoa(o), ip || ('10.0.0.' + (++ipSeq)));

async function http(body, cookie, headers) {
  const res = { code: 0, body: null,
    status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  await write({ method: 'POST', body, headers: Object.assign({ cookie: cookie || '' }, headers || {}) }, res);
  return res;
}

(async () => {
  // ── chave do link ─────────────────────────────────────────
  check('chave tem 16 caracteres hex', /^[0-9a-f]{16}$/.test(KEY), KEY);
  check('chave confere', C.checkCursoKey(KEY));
  check('chave errada / vazia / outro tipo é recusada',
    !C.checkCursoKey(KEY.slice(0, -1) + (KEY.endsWith('0') ? '1' : '0')) && !C.checkCursoKey('') && !C.checkCursoKey(undefined) && !C.checkCursoKey(['x']));
  check('link aponta para o domínio de produção',
    C.cursoUrl('http://localhost:3000') === 'https://njr.example.app/curso-schluter?key=' + KEY, C.cursoUrl(''));

  // ── validação ─────────────────────────────────────────────
  check('telefone dos EUA é formatado', C.formataTelefone('6175550100') === '(617) 555-0100' && C.formataTelefone('+1 617.555.0100') === '(617) 555-0100');
  check('telefone de outro país fica como digitado', C.formataTelefone('+55 11 98765-4321') === '+55 11 98765-4321');
  const recusa = (o, campo) => { const v = C.valida(pessoa(o)); return v.error ? true : campo + ' devia ser recusado: ' + JSON.stringify(o); };
  await roda('nome curto / sem letra inicial / fórmula / html é recusado', async () =>
    [recusa({ nome: 'Jo' }), recusa({ nome: '123 Silva' }), recusa({ nome: '=HYPERLINK("http://x","clique")' }),
      recusa({ nome: '+cmd' }), recusa({ nome: 'Ana <script>' })].find(r => r !== true) || true);
  await roda('telefone curto / longo / com letra é recusado', async () =>
    [recusa({ telefone: '555-0100' }), recusa({ telefone: '1234567890123456' }), recusa({ telefone: '617555010x' }),
      recusa({ telefone: '=1+6175550100' })].find(r => r !== true) || true);
  await roda('nome, telefone e e-mail vazios são recusados (obrigatórios)', async () =>
    [recusa({ nome: '' }, 'nome'), recusa({ nome: undefined }, 'nome'), recusa({ telefone: '' }, 'telefone'),
      recusa({ telefone: undefined }, 'telefone'), recusa({ email: '' }, 'email'), recusa({ email: undefined }, 'email')].find(r => r !== true) || true);
  await roda('empresa é opcional; com < > é recusada', async () => {
    const sem = C.valida(pessoa());
    const com = C.valida(pessoa({ empresa: '  ACME   Tile & Stone ' }));
    if (sem.error || sem.empresa !== '') return 'sem empresa: ' + JSON.stringify(sem);
    if (com.empresa !== 'ACME Tile & Stone') return 'com empresa: ' + JSON.stringify(com);
    return recusa({ empresa: '<b>X</b>' }, 'empresa');
  });
  await roda('e-mail inválido é recusado', async () =>
    [recusa({ email: 'carlos@' }), recusa({ email: 'carlos x@y.com' }), recusa({ email: 'a@b.c' })].find(r => r !== true) || true);
  await roda('nome com acento, apóstrofo e hífen passa', async () => {
    const v = C.valida(pessoa({ nome: "  João  D'Ávila-Neto ", email: ' JOAO@X.COM ' }));
    return (v.nome === "João D'Ávila-Neto" && v.email === 'joao@x.com') || JSON.stringify(v);
  });

  // ── gravação ──────────────────────────────────────────────
  await roda('1º envio cria a aba com cabeçalho e grava a pessoa', async () => {
    const r = await inscreve();
    if (!r.ok) return JSON.stringify(r);
    const s = SHEETS['Curso Schluter'];
    if (!s) return 'aba não criada';
    if (s[0].join('|') !== C.CURSO_HEADERS.join('|')) return 'cabeçalho: ' + s[0].join('|');
    return (linhas().length === 1 && semApostrofo(linhas()[0][1]) === 'Carlos Souza') || JSON.stringify(linhas());
  });
  await roda('nome, telefone e e-mail vão como texto literal (apóstrofo)', async () => {
    const r = linhas()[0];
    return (r[1] === "'Carlos Souza" && r[2] === "'(617) 555-0100" && r[3] === "'carlos@x.com" && r[4] === '') || JSON.stringify(r);
  });
  await roda('empresa informada vai como texto literal na coluna Empresa', async () => {
    const r = await inscreve({ nome: 'Bia Costa', empresa: '=Bia Tile', telefone: '781-555-0300', email: 'bia@x.com' });
    const l = linhas().find(x => semApostrofo(x[1]) === 'Bia Costa');
    const ok = r.ok && l && l[4] === "'=Bia Tile";
    SHEETS['Curso Schluter'] = SHEETS['Curso Schluter'].filter(x => x !== l); // não atrapalha as contagens abaixo
    return ok || JSON.stringify(l);
  });
  await roda('mesmo telefone com outra formatação não duplica', async () => {
    const r = await inscreve({ telefone: '+1 (617) 555 0100', email: 'outro@x.com', nome: 'Carlos S' });
    return (r.ok && !r.already && linhas().length === 1) || 'linhas: ' + linhas().length + ' resp: ' + JSON.stringify(r);
  });
  await roda('mesmo e-mail (maiúsculas) não duplica', async () => {
    const r = await inscreve({ telefone: '508-555-0199', email: 'CARLOS@X.com' });
    return (r.ok && linhas().length === 1) || 'linhas: ' + linhas().length;
  });
  await roda('resposta do repetido é idêntica à de um cadastro novo', async () => {
    const novo = await inscreve({ telefone: '978-555-0101', email: 'ana@x.com', nome: 'Ana Lima' });
    const rep = await inscreve({ telefone: '978-555-0101', email: 'ana@x.com', nome: 'Ana Lima' });
    return (JSON.stringify(novo) === JSON.stringify(rep) && linhas().length === 2) || JSON.stringify([novo, rep]);
  });

  // ── robôs ─────────────────────────────────────────────────
  await roda('honeypot preenchido → "ok" e nada gravado', async () => {
    const r = await inscreve({ site: 'http://spam', telefone: '857-555-0001', email: 'b1@x.com' });
    return (r.ok && linhas().length === 2) || 'linhas: ' + linhas().length;
  });
  await roda('envio instantâneo ou sem tempo → "ok" e nada gravado', async () => {
    const a = await inscreve({ ms: 300, telefone: '857-555-0002', email: 'b2@x.com' });
    const b = await inscreve({ ms: undefined, telefone: '857-555-0003', email: 'b3@x.com' });
    const c = await inscreve({ ms: 'abc', telefone: '857-555-0004', email: 'b4@x.com' });
    return (a.ok && b.ok && c.ok && linhas().length === 2) || 'linhas: ' + linhas().length;
  });

  // ── limite por IP e teto ──────────────────────────────────
  await roda('mesmo IP: 6 envios passam, o 7º é barrado', async () => {
    const rs = [];
    for (let i = 0; i < 7; i++) rs.push(await inscreve({ nome: 'Pessoa ' + 'abcdefg'[i], telefone: '339-555-01' + (10 + i), email: 'ip' + i + '@x.com' }, '200.1.1.1'));
    const outro = await inscreve({ telefone: '339-555-0199', email: 'ip-outro@x.com' }, '200.1.1.2');
    return (rs.slice(0, 6).every(r => r.ok) && rs[6].error && outro.ok) || JSON.stringify(rs.map(r => r.ok || r.error));
  });
  await roda('aba cheia → recusa sem gravar', async () => {
    const s = SHEETS['Curso Schluter'];
    const antes = s.length;
    while (s.length <= 1500) s.push(['', 'X', '000', 'x' + s.length + '@x.com']);
    const r = await inscreve({ telefone: '781-555-0123', email: 'cheio@x.com' });
    const n = s.length;
    s.length = antes;
    return (r.error && n === 1501) || JSON.stringify(r);
  });

  // ── despacho no write.js ──────────────────────────────────
  await roda('chave errada → 403 "fechado", nada gravado', async () => {
    const n = linhas().length;
    const r = await http(Object.assign({ action: 'cursoInscrever', key: 'abc' }, pessoa({ telefone: '774-555-0100', email: 'k@x.com' })));
    return (r.code === 403 && r.body.fechado === true && linhas().length === n) || JSON.stringify(r);
  });
  await roda('cursoStatus com chave certa → 200 sem dado nenhum', async () => {
    const r = await http({ action: 'cursoStatus', key: KEY });
    return (r.code === 200 && JSON.stringify(r.body) === '{"ok":true}') || JSON.stringify(r);
  });
  await roda('cursoInscrever pelo endpoint grava e devolve só {ok:true}', async () => {
    const n = linhas().length;
    const r = await http(Object.assign({ action: 'cursoInscrever', key: KEY }, pessoa({ nome: 'Rafa Melo', telefone: '774-555-0111', email: 'rafa@x.com' })),
      '', { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' });
    return (r.code === 200 && JSON.stringify(r.body) === '{"ok":true}' && linhas().length === n + 1) || JSON.stringify(r);
  });
  await roda('erro interno → 500 com mensagem genérica (nada da API vaza)', async () => {
    falharLeitura = true;
    const origErr = console.error; console.error = () => {};
    const r = await http(Object.assign({ action: 'cursoInscrever', key: KEY }, pessoa({ telefone: '774-555-0122', email: 'e@x.com' })),
      '', { 'x-forwarded-for': '8.8.8.8' });
    console.error = origErr; falharLeitura = false;
    return (r.code === 500 && !/quota|adminnjr|project/i.test(r.body.error)) || JSON.stringify(r);
  });
  await roda('ações do painel exigem login (getCursoLink / deleteCursoInscrito)', async () => {
    const a = await http({ action: 'getCursoLink', key: KEY });
    const b = await http({ action: 'deleteCursoInscrito', rowNum: 2, key: KEY });
    return (a.code === 401 && b.code === 401 && !apagadas.length) || JSON.stringify([a.code, b.code]);
  });

  // ── exclusão pelo painel ──────────────────────────────────
  await roda('excluir confere o telefone: linha mudou → recusa', async () => {
    const r = await C.deleteCursoInscrito({ rowNum: 2, telefone: '(999) 555-0000' });
    return (r.error && !apagadas.length) || JSON.stringify(r);
  });
  await roda('excluir com o telefone certo apaga a linha', async () => {
    const r = await C.deleteCursoInscrito({ rowNum: 2, telefone: '(617) 555-0100' });
    return (r.ok && apagadas.join() === '2' && !linhas().some(l => semApostrofo(l[2]) === '(617) 555-0100')) || JSON.stringify(r);
  });

  // ── aba criada antes do campo Empresa ─────────────────────
  await roda('aba antiga sem "Empresa": coluna entra no fim e as linhas antigas ficam intactas', async () => {
    reset();
    SHEETS['Curso Schluter'] = [['Carimbo de data/hora', 'Nome', 'Telefone', 'E-mail'],
      ['2026-10-23 10:00:00', "'Velho Cadastro", "'(617) 555-0999", "'velho@x.com"]];
    const r = await inscreve({ nome: 'Novo Cadastro', empresa: 'Tile Co', telefone: '508-555-0777', email: 'novo@x.com' });
    const s = SHEETS['Curso Schluter'];
    if (!r.ok) return JSON.stringify(r);
    if (s[0].join('|') !== 'Carimbo de data/hora|Nome|Telefone|E-mail|Empresa') return 'cabeçalho: ' + s[0].join('|');
    if (s[1].length !== 4 || s[1][1] !== "'Velho Cadastro") return 'linha antiga mudou: ' + JSON.stringify(s[1]);
    return (s[2][1] === "'Novo Cadastro" && s[2][4] === "'Tile Co") || JSON.stringify(s[2]);
  });

  console.log(fails ? '\n  ' + fails + ' falha(s)' : '\n  formulário do curso — tudo certo');
  process.exit(fails ? 1 : 0);
})();
