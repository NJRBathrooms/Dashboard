// Testa o botão "Atualizar" do cabeçalho do index.html: relê /api/data e
// repinta as telas sem recarregar a página.
//
// O que importa aqui: o dado novo tem que chegar à tela (o app pinta do cache
// local, então uma leitura velha passaria batido), o clique duplo não pode
// disparar duas leituras, e uma falha de rede não pode deixar o botão travado.
//
// Rodar: node scripts/test-refresh.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html)[1];

// ── o botão existe no cabeçalho e chama a função ──
let fails = 0;
const ok = n => console.log('  ok  ' + n);
const bad = (n, d) => { fails++; console.log('  FALHOU  ' + n + (d ? '\n          ' + d : '')); };

const hdr = html.slice(html.indexOf('class="app-header"'), html.indexOf('class="tab-nav"'));
hdr.includes('id="refreshBtn"') ? ok('botão existe no cabeçalho') : bad('botão existe no cabeçalho');
hdr.includes('onclick="refreshData()"') ? ok('botão chama refreshData()') : bad('botão chama refreshData()');
/\.refresh-btn\s*\{/.test(html) ? ok('CSS .refresh-btn definido') : bad('CSS .refresh-btn definido');

// ── DOM simulado ──
const els = {};
function mkEl(id) {
  if (els[id]) return els[id];
  const cls = new Set();
  return (els[id] = {
    id, innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
    options: [], files: [], scrollLeft: 0, offsetWidth: 800,
    style: new Proxy({}, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => (t[k] = v, true) }),
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c), _set: cls },
    dataset: {}, children: [], parentNode: null,
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, remove() {},
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() {},
    setAttribute() {}, getAttribute: () => null, scrollIntoView() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    getContext: () => ({}), querySelector: () => null, querySelectorAll: () => [],
    animate: () => ({ finished: Promise.resolve() }),
  });
}
const doc = {
  getElementById: id => mkEl(id), querySelector: () => null, querySelectorAll: () => [],
  createElement: () => mkEl('_t' + Math.random()), addEventListener() {}, removeEventListener() {},
  body: mkEl('body'), documentElement: mkEl('html'), cookie: '',
};

// fetch controlável + localStorage de verdade (em memória)
let proximaResposta = null, fetches = 0, guardado = {};
const noop = () => {};
const sandbox = {
  document: doc,
  window: { addEventListener: noop, removeEventListener: noop, open: noop, print: noop,
    matchMedia: () => ({ matches: false, addListener: noop, addEventListener: noop }),
    location: { href: '', reload: noop }, innerWidth: 1200, scrollTo: noop },
  localStorage: {
    getItem: k => (k in guardado ? guardado[k] : null),
    setItem: (k, v) => { guardado[k] = String(v); }, removeItem: k => { delete guardado[k]; },
  },
  navigator: { userAgent: 'node', serviceWorker: { register: () => Promise.resolve() } },
  fetch: async () => { fetches++; return proximaResposta(); },
  Chart: Object.assign(function () { return { destroy: noop, update: noop, resize: noop }; }, { register: noop }),
  ChartDataLabels: {}, alert: noop, confirm: () => true, prompt: () => null,
  setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
  setInterval: noop, clearTimeout: noop, clearInterval: noop,
  requestAnimationFrame: noop, getComputedStyle: () => ({ getPropertyValue: () => '' }), console,
};
// Se a suíte morrer no meio (promise pendente, exceção engolida), o node sairia
// com 0 e o teste "passaria" sem ter rodado. Esta rede impede isso.
let CHEGOU_AO_FIM = false;
process.on('exit', c => {
  if (!CHEGOU_AO_FIM && c === 0) {
    console.log('\n  FALHOU  a suíte terminou antes do fim — nenhum resultado é confiável');
    process.exitCode = 1;
  }
});

const nomes = Object.keys(sandbox);
const run = new Function(...nomes, '__export', code +
  '\n__export({ refreshData, setDB:v=>{DB=v}, getDB:()=>DB, getPROC:()=>PROC, renderAll });');
const api = {};
run(...nomes.map(k => sandbox[k]), o => Object.assign(api, o));

const obra = (addr, orc) => ({ _row: 2, 'Endereço': addr, 'Nome do Cliente': 'X', 'Contato': '1',
  'Escopo': 'e', 'Orçamento': orc, 'Data Início Prevista': '2026-09-01', 'Data Fim Prevista': '2026-09-20',
  'Link Fotos Antes': '', 'Finalizada': 'Não', 'Data Finalização': '', 'Link Fotos Depois': '' });
const vazio = { obras: [], labor: [], materials: [], subcontractors: [], clients: [],
  ajustes: [], subProfiles: [], funcionarios: [], rateHistory: [], drywall: [], lastUpdated: '2026-10-05 10:00:00' };

(async () => {
  // ── o dado novo chega à tela ──
  api.setDB({ ...vazio, obras: [obra('1 Antiga St', 1000)] });
  api.renderAll();
  proximaResposta = async () => ({ ok: true, status: 200, json: async () => ({ ...vazio, obras: [obra('2 Nova Ave', 7777)] }) });
  await api.refreshData();

  const obras = api.getPROC().obras || [];
  obras.length === 1 && obras[0].addr === '2 Nova Ave'
    ? ok('dado novo substitui o antigo e é reprocessado')
    : bad('dado novo substitui o antigo', 'obras agora: ' + JSON.stringify(obras.map(o => o.addr)));

  guardado['njr_db_cache'] && guardado['njr_db_cache'].includes('2 Nova Ave')
    ? ok('cache local é regravado com o dado novo')
    : bad('cache local é regravado', 'cache: ' + String(guardado['njr_db_cache']).slice(0, 80));

  /Att: \d{2}:\d{2}/.test(els['updateBadge'].innerHTML)
    ? ok('badge volta para o horário da última leitura')
    : bad('badge mostra o horário', els['updateBadge'].innerHTML);

  els['refreshBtn'].disabled === false && !els['refreshBtn'].classList.contains('spinning')
    ? ok('botão reabilitado e sem spinner ao terminar')
    : bad('botão reabilitado ao terminar');

  // ── clique duplo não dispara duas leituras ──
  // As duas chamadas compartilham a MESMA promise: sem isso, a segunda criaria
  // uma promise que ninguém resolve e o teste morreria no meio em silêncio.
  fetches = 0;
  let solta;
  const pendente = new Promise(r => { solta = r; });
  proximaResposta = () => pendente.then(() => ({ ok: true, status: 200, json: async () => ({ ...vazio }) }));
  const p1 = api.refreshData();
  const p2 = api.refreshData();          // clicou de novo durante a primeira
  solta();
  await Promise.all([p1, p2]);
  fetches === 1 ? ok('clique duplo faz só uma leitura') : bad('clique duplo faz só uma leitura', fetches + ' fetches');

  // ── falha de rede não trava o botão ──
  proximaResposta = async () => { throw new Error('rede caiu'); };
  await api.refreshData();
  els['refreshBtn'].disabled === false && !els['refreshBtn'].classList.contains('spinning')
    ? ok('erro de rede não deixa o botão travado')
    : bad('erro de rede não deixa o botão travado');
  els['updateBadge'].className.includes('err')
    ? ok('erro aparece no badge')
    : bad('erro aparece no badge', els['updateBadge'].className);

  // o dado anterior continua na tela depois de uma falha
  (api.getPROC().obras || []).length === 0 && api.getDB().obras.length === 0
    ? ok('falha não apaga o que já estava carregado')
    : bad('falha não apaga o que já estava carregado');

  // ── erro vindo da própria API (200 com {error}) ──
  proximaResposta = async () => ({ ok: true, status: 200, json: async () => ({ error: 'planilha indisponível' }) });
  await api.refreshData();
  els['updateBadge'].className.includes('err') && els['refreshBtn'].disabled === false
    ? ok('erro devolvido pela API é tratado como falha')
    : bad('erro devolvido pela API é tratado como falha');

  // ── sessão expirada derruba para o login ──
  fetches = 0;
  proximaResposta = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Não autorizado.' }) });
  await api.refreshData();
  els['refreshBtn'].disabled === false
    ? ok('401 não deixa o botão travado')
    : bad('401 não deixa o botão travado');

  CHEGOU_AO_FIM = true;
  console.log(fails ? '\n' + fails + ' falha(s).' : '\nrefresh ok.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('  FALHOU  exceção não tratada: ' + e.message); process.exit(1); });
