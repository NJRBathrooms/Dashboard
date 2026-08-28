// Executa de verdade o <script> do index.html num DOM simulado e chama as funções
// de render.
//
// Existe porque "node --check" só enxerga sintaxe: uma chamada a função inexistente
// passa no check e só quebra em produção. Foi assim que a aba Drywall caiu — um
// patch aplicado com String.replace transformou $( (formatador de moeda) em $(,
// porque em replace() a sequência $ significa "um $ literal".
//
// Rodar: node scripts/test-render.js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html);
const code = m[1];

const els = {};
function mkEl(id) {
  return els[id] = els[id] || {
    id, innerHTML: '', textContent: '', value: '', disabled: false, options: [], selectedIndex: -1,
    style: new Proxy({}, { get: (t, k) => t[k] ?? '', set: (t, k, v) => (t[k] = v, true) }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {}, appendChild() {}, addEventListener() {}, focus() {}, click() {},
    querySelector: () => null, querySelectorAll: () => [],
    getContext: () => ({}), // canvas dos gráficos (Chart.js está stubado)
  };
}
const doc = {
  getElementById: id => mkEl(id),
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => mkEl('_tmp' + Math.random()),
  addEventListener() {}, body: mkEl('body'), documentElement: mkEl('html'),
};
const noop = () => {};
const sandbox = {
  document: doc,
  window: { addEventListener: noop, matchMedia: () => ({ matches: false, addListener: noop }), open: noop, location: { href: '' } },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  navigator: { userAgent: 'node' },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  Chart: function () { return { destroy: noop, update: noop }; },
  ChartDataLabels: {}, // plugin carregado por <script src> na página real
  alert: noop, confirm: () => true, setTimeout: noop, setInterval: noop, clearTimeout: noop,
  console,
};
sandbox.Chart.register = noop;

const names = Object.keys(sandbox);
const vals = names.map(k => sandbox[k]);
const run = new Function(...names, '__export',
  code + '\n__export({ renderDrywall, renderObrasDrywall, processAll, obraDetailHTML, renderTab1, renderFinObraDetail, setState:(k,v)=>{ if(k==="PROC")PROC=v; if(k==="DW_DATA")DW_DATA=v; if(k==="DW_CLI_MES")DW_CLI_MES=v; if(k==="DW_MES")DW_MES=v; if(k==="SEL_ADDR")SEL_ADDR=v; if(k==="SEL_FIN_ADDR")SEL_FIN_ADDR=v; }, getPROC:()=>PROC });');

const api = {};
run(...vals, o => Object.assign(api, o));

// dados de exemplo, com dois clientes e um serviço sem cliente
const drywall = [
  { _row: 2, data: '2026-08-12', cliente: 'Maria Silva', addr: '12 Oak St',   valorCobrado: '800', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 200 },
  { _row: 3, data: '2026-08-12', cliente: 'Joe Brown',   addr: '40 Pine Ave', valorCobrado: '600', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 200 },
  { _row: 4, data: '2026-08-12', cliente: '',            addr: '8 Elm Rd',    valorCobrado: '950', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 200 },
  { _row: 5, data: '2026-08-13', cliente: 'Maria Silva', addr: '77 Ash Way',  valorCobrado: '450', pessoa: 'Ana',    companhia: 'DW Crew',     diaria: 180 },
];
const P = api.getPROC();
P.drywall = drywall;
api.setState('DW_DATA', '2026-08-12');
api.setState('DW_CLI_MES', '2026-08');
api.setState('DW_MES', '2026-08');

let fails = 0;
const check = (nome, cond, extra) => {
  if (cond) console.log('  ok  ' + nome);
  else { fails++; console.log('  FALHOU  ' + nome + (extra ? '\n         ' + extra : '')); }
};

try {
  api.renderDrywall();
  const out = els['t8body'].innerHTML;
  check('renderDrywall() executa sem erro', out.length > 0);
  check('tabela de clientes foi montada', out.includes('Clientes de drywall'));
  check('valores em dólar aparecem formatados', /\$\s?1?,?\d/.test(out), out.slice(0, 200));
  check('sem "undefined" no HTML gerado', !out.includes('undefined'));
  check('Maria Silva soma os 2 endereços dela', /Maria Silva[\s\S]{0,400}?<td>2<\/td>/.test(out));
  check('serviço sem cliente aparece como (sem cliente)', out.includes('(sem cliente)'));
  check('total do dia (CUSTO DO DIA) renderiza com valor', /CUSTO DO DIA[\s\S]{0,200}?\$/.test(out));
} catch (e) {
  fails++;
  console.log('  FALHOU  renderDrywall() lançou: ' + e.message);
}

try {
  api.renderObrasDrywall();
  const out2 = els['st1dw'].innerHTML;
  check('renderObrasDrywall() (sub-aba Obras Drywall) executa', out2.includes('Serviços de drywall'));
  check('sub-aba sem "undefined"', !out2.includes('undefined'));
} catch (e) {
  fails++;
  console.log('  FALHOU  renderObrasDrywall() lançou: ' + e.message);
}

// ── telas de obra (mesma classe de risco: também foram alteradas por patch) ──
P.obras = [
  { addr: '4 Tara rd, Essex', cliente: 'Andrew', contato: '555-0100', escopo: 'Banheiro', orcamento: 6240,
    dtInicio: '2026-07-01', dtFim: '2026-08-01', fotosBefore: '', finalizada: false, dtFinal: '', fotosAfter: '' },
  { addr: '66 Knotty way Belmont NH', cliente: '', contato: '', escopo: '', orcamento: 0,
    dtInicio: '', dtFim: '', fotosBefore: '', finalizada: true, dtFinal: '2026-01-10', fotosAfter: '' },
];
P.labor = [
  { _row: 2, ts: new Date('2026-07-10T12:00:00'), addr: '4 Tara rd, Essex', nome: 'João La Pastina',
    hrs: 8, rate: 25, laborCost: 200, reimb: 0, receipts: [] },
];
P.materials = [
  { _row: 2, ts: new Date('2026-07-11T12:00:00'), dataCom: '2026-07-11', addr: '4 Tara rd, Essex',
    desc: 'Tile', amount: 300, cobradoRaw: '', comprovante: '', isExtra: false },
];
P.subs = [];

const telas = [
  ['obra ativa (com estimate) — tem botão Encerrar obra', '4 Tara rd, Essex',
    o => o.includes('Encerrar obra') && o.includes('Resultado Financeiro') && !o.includes('Cadastro incompleto')],
  ['obra finalizada — NÃO tem botão Encerrar obra', '66 Knotty way Belmont NH',
    o => !o.includes('Encerrar obra') && o.includes('Cadastro incompleto')],
];
telas.forEach(([nome, addr, cond]) => {
  try {
    const out = api.obraDetailHTML(addr, { donut: 'd', budget: 'b', bar: 'r' });
    check(nome + ' — renderiza', out.length > 0);
    check(nome + ' — sem "undefined"', !out.includes('undefined'), out.slice(0, 300));
    check(nome + ' — conteúdo esperado', cond(out));
  } catch (e) {
    fails++; console.log('  FALHOU  ' + nome + ' lançou: ' + e.message);
  }
});

// obra sem cadastro nenhum (só lançamentos) precisa oferecer "Completar cadastro"
try {
  P.labor.push({ _row: 3, ts: new Date('2026-07-12T12:00:00'), addr: '14 Bradford road Hamilton',
    nome: 'João La Pastina', hrs: 4, rate: 25, laborCost: 100, reimb: 0, receipts: [] });
  const out = api.obraDetailHTML('14 Bradford road Hamilton', { donut: 'd', budget: 'b', bar: 'r' });
  check('obra sem cadastro — oferece Completar cadastro', out.includes('Completar cadastro'));
  check('obra sem cadastro — oferece Encerrar obra', out.includes('Encerrar obra'));
  check('obra sem cadastro — sem "undefined"', !out.includes('undefined'));
} catch (e) {
  fails++; console.log('  FALHOU  obra sem cadastro lançou: ' + e.message);
}

// barra de reabrir, na aba Obras Finalizadas
try {
  api.setState('SEL_FIN_ADDR', '66 Knotty way Belmont NH');
  api.renderFinObraDetail();
  const out = els['t4DetailBody'].innerHTML;
  check('Obras Finalizadas — mostra botão Reabrir obra', out.includes('Reabrir obra'));
  check('Obras Finalizadas — sem "undefined"', !out.includes('undefined'));
} catch (e) {
  fails++; console.log('  FALHOU  renderFinObraDetail lançou: ' + e.message);
}

console.log(fails ? '\n' + fails + ' falha(s).' : '\nrender ok.');
process.exit(fails ? 1 : 0);
