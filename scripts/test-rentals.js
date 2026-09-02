// Executa o <script> do rentals.html num DOM simulado e verifica a lógica de
// dinheiro do app de aluguéis — em especial a água, que a partir de 02/09/2026
// deixou de ser somada ao aluguel e passou a ser cobrança com status próprio.
//
// O que mais importa aqui são as identidades contábeis: água pendente NÃO pode
// contar como receita, e água reembolsada TEM que contar. Um erro nisso vai
// direto para o relatório do contador.
//
// Rodar: node scripts/test-rentals.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'rentals.html'), 'utf8');
const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.error('FALHOU: <script> não encontrado no rentals.html'); process.exit(1); }

const els = {};
function mkEl(id) {
  if (els[id]) return els[id];
  return (els[id] = {
    id, innerHTML: '', textContent: '', value: '', disabled: false, checked: false, options: [],
    style: new Proxy({}, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => (t[k] = v, true) }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {}, appendChild() {}, addEventListener() {}, focus() {}, click() {}, remove() {},
    setAttribute() {}, getAttribute: () => null, scrollIntoView() {}, animate: () => ({}),
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 600 }),
    querySelector: () => null, querySelectorAll: () => [],
  });
}
const doc = {
  getElementById: id => mkEl(id),
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => mkEl('_t' + Math.random()),
  addEventListener() {}, body: mkEl('body'), documentElement: mkEl('html'), cookie: '',
};
const noop = () => {};
const sandbox = {
  document: doc,
  window: { addEventListener: noop, matchMedia: () => ({ matches: false, addListener: noop }), open: noop, print: noop, location: { href: '' }, innerWidth: 1200 },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  navigator: { userAgent: 'node' },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  alert: noop, confirm: () => true,
  setTimeout: noop, setInterval: noop, clearTimeout: noop, requestAnimationFrame: noop,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  console,
};
const nomes = Object.keys(sandbox);
const run = new Function(...nomes, '__export', m[1] +
  '\n__export({ renderDash, renderCustos, renderFin, anualData, hcardHTML, houseState,' +
  ' aguaPendentesAte, aguaRepassadas, aguaRecebidaNoMes, somaAgua, expectedRent, rateio, aguaPaga,' +
  ' setDB:v=>{DB=v}, setComp:(k,v)=>{ if(k==="dash")dashComp=v; if(k==="cust")custComp=v; if(k==="fin")FIN_COMP=v; } });');
const api = {};
run(...nomes.map(k => sandbox[k]), o => Object.assign(api, o));

// ── fixture: espelha a produção + os três eventos relatados pela Paula ──
const DB = {
  casas: [
    { _row: 4, 'Endereço': '79 Appleton Cir, Fitchburg MA', 'Inquilino': 'Karysten Braga', 'Status': 'Ocupada', 'Aluguel Mensal': 2400, 'Security Deposit': 2400, 'Mortgage Mensal': 0 },
    { _row: 3, 'Endereço': '15 Foch Ave, Fitchburg MA (upstairs)', 'Inquilino': 'Diego da Silva Alves', 'Status': 'Ocupada', 'Aluguel Mensal': 1700, 'Security Deposit': 1700, 'Mortgage Mensal': 0 },
    { _row: 7, 'Endereço': '15 Foch Ave, Fitchburg MA (downstairs)', 'Inquilino': 'Nelson Alves da Rocha', 'Status': 'Ocupada', 'Aluguel Mensal': 2300, 'Security Deposit': 2300, 'Mortgage Mensal': 0 },
  ],
  recebimentos: [
    { _row: 3, 'Endereço': '79 Appleton Cir, Fitchburg MA', 'Competência': '2026-07', 'Valor do Aluguel': 2400, 'Data do Pagamento': '2026-07-08', 'Multa': 0, 'Total Recebido': 2400, 'Status': 'Pago' },
    { _row: 13, 'Endereço': '79 Appleton Cir, Fitchburg MA', 'Competência': '2026-08', 'Valor do Aluguel': 2400, 'Data do Pagamento': '2026-08-09', 'Multa': 0, 'Total Recebido': 2400, 'Status': 'Pago' },
  ],
  custos: [
    // Evento 3 — repassada ao inquilino, ainda não paga (julho e agosto)
    { _row: 20, 'Endereço': '79 Appleton Cir, Fitchburg MA', 'Competência': '2026-07', 'Tipo': 'Água', 'Valor': 118, 'Data do Pagamento': '2026-08-31', 'Pagador': 'Inquilino', 'Status Repasse': 'Pendente', 'Data do Repasse': '' },
    { _row: 21, 'Endereço': '79 Appleton Cir, Fitchburg MA', 'Competência': '2026-08', 'Tipo': 'Água', 'Valor': 140, 'Data do Pagamento': '2026-08-31', 'Pagador': 'Inquilino', 'Status Repasse': 'Pendente', 'Data do Repasse': '' },
    // Evento 2 — proprietário assume, conta do prédio rateada entre as duas unidades
    { _row: 22, 'Endereço': '15 Foch Ave, Fitchburg MA (upstairs)', 'Competência': '2026-07', 'Tipo': 'Água', 'Valor': 132, 'Data do Pagamento': '2026-08-31', 'Pagador': 'Proprietário', 'Status Repasse': '', 'Data do Repasse': '' },
    { _row: 23, 'Endereço': '15 Foch Ave, Fitchburg MA (downstairs)', 'Competência': '2026-07', 'Tipo': 'Água', 'Valor': 132, 'Data do Pagamento': '2026-08-31', 'Pagador': 'Proprietário', 'Status Repasse': '', 'Data do Repasse': '' },
    // repassada E já reembolsada, para checar a receita
    { _row: 24, 'Endereço': '15 Foch Ave, Fitchburg MA (upstairs)', 'Competência': '2026-08', 'Tipo': 'Água', 'Valor': 60, 'Data do Pagamento': '2026-08-31', 'Pagador': 'Inquilino', 'Status Repasse': 'Pago', 'Data do Repasse': '2026-08-31' },
  ],
  manutencao: [], historico: [], alertas: [],
};

let fails = 0;
const eq = (nome, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) console.log('  ok  ' + nome);
  else { fails++; console.log('  FALHOU  ' + nome + '\n          esperado ' + JSON.stringify(b) + '\n          obtido   ' + JSON.stringify(a)); }
};
const roda = (nome, fn) => { try { fn(); } catch (e) { fails++; console.log('  FALHOU  ' + nome + ' lançou: ' + e.message); } };

api.setDB(DB);
api.setComp('dash', '2026-08');
api.setComp('cust', '2026-08');
api.setComp('fin', '2026-08');

const APP = '79 Appleton Cir, Fitchburg MA';
const FOCH_UP = '15 Foch Ave, Fitchburg MA (upstairs)';

// ── a água saiu do aluguel esperado ──
eq('aluguel esperado não inclui mais a água', api.expectedRent(DB.casas[0], '2026-08'), 2400);

roda('mês com aluguel pago e água pendente NÃO é "parcial"', () => {
  const st = api.houseState(DB.casas[0], '2026-08');
  eq('  status do aluguel', st.key, 'paid');
});

// ── dívida de água não some com a virada do mês ──
eq('água pendente em agosto inclui a de julho', api.somaAgua(api.aguaPendentesAte(APP, '2026-08')), 258);
eq('em julho só a de julho aparece', api.somaAgua(api.aguaPendentesAte(APP, '2026-07')), 118);
eq('água assumida pelo proprietário não vira dívida do inquilino',
  api.aguaPendentesAte(FOCH_UP, '2026-07').length, 0);
eq('água já reembolsada sai da lista de pendentes',
  api.aguaPendentesAte(FOCH_UP, '2026-08').length, 0);

// ── receita: só conta a água efetivamente reembolsada ──
eq('receita de água em agosto = só a reembolsada', api.aguaRecebidaNoMes('2026-08'), 60);
eq('julho não tem água reembolsada', api.aguaRecebidaNoMes('2026-07'), 0);

// ── rateio em centavos exatos ──
roda('rateio de conta do prédio fecha no centavo', () => {
  [[264, 2], [224, 2], [100, 3], [0.01, 2], [1234.57, 4]].forEach(([v, n]) => {
    const parts = api.rateio(v, n);
    const soma = Math.round(parts.reduce((s, x) => s + x, 0) * 100) / 100;
    if (soma !== v) { fails++; console.log('  FALHOU  rateio ' + v + '/' + n + ' somou ' + soma); return; }
  });
  console.log('  ok  rateio de conta do prédio fecha no centavo');
});

// ── telas montam sem erro e sem lixo ──
const semLixo = (nome, id) => {
  const h = els[id] ? els[id].innerHTML : '';
  if (!h) { fails++; console.log('  FALHOU  ' + nome + ': tela vazia'); return; }
  if (h.includes('undefined') || h.includes('NaN')) { fails++; console.log('  FALHOU  ' + nome + ': contém undefined/NaN'); return; }
  console.log('  ok  ' + nome);
};
roda('renderDash executa', () => { api.renderDash(); semLixo('dashboard monta', 'tab1'); });
roda('renderCustos executa', () => { api.renderCustos(); semLixo('aba de custos monta', 'tab3'); });
roda('renderFin executa', () => { api.renderFin(); semLixo('financeiro monta', 'tab5'); });

roda('card mostra a água pendente e o botão de marcar pago', () => {
  const h = api.hcardHTML(DB.casas[0], api.houseState(DB.casas[0], '2026-08'));
  const ok = h.includes('Água pendente') && h.includes('Marcar pago')
    && h.includes('pendente de mês anterior');   // a de julho aparece no card de agosto
  if (!ok) { fails++; console.log('  FALHOU  card não trouxe a água pendente como esperado'); }
  else console.log('  ok  card mostra a água pendente e o botão de marcar pago');
});

roda('card de água assumida pelo proprietário não cobra nada do inquilino', () => {
  const c = DB.casas.find(x => x['Endereço'] === FOCH_UP);
  const h = api.hcardHTML(c, api.houseState(c, '2026-07'));
  if (h.includes('Água pendente')) { fails++; console.log('  FALHOU  água assumida não pode virar cobrança'); }
  else console.log('  ok  card de água assumida pelo proprietário não cobra nada do inquilino');
});

// ── relatório anual: a identidade que vai para o contador ──
roda('relatório anual separa despesa (sempre) de receita (só se reembolsada)', () => {
  const d = api.anualData('2026');
  const itens = d.items || [];
  const desp = itens.filter(i => i.categoria === 'Utilities');
  const rec = itens.filter(i => i.desc === 'Água reembolsada pelo inquilino');
  const totDesp = Math.round(desp.reduce((s, i) => s + i.despesa, 0) * 100) / 100;
  const totRec = Math.round(rec.reduce((s, i) => s + i.receita, 0) * 100) / 100;
  // 118+140+132+132+60 = 582 de despesa; só os 60 reembolsados viram receita
  eq('  despesa de Utilities = tudo que a NJR pagou', totDesp, 582);
  eq('  receita de água = só o que o inquilino reembolsou', totRec, 60);
});

console.log(fails ? '\n' + fails + ' falha(s).' : '\nrentals ok.');
process.exit(fails ? 1 : 0);
