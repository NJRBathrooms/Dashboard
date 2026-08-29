// Executa de verdade o <script> do index.html num DOM simulado e chama TODAS as
// telas do app com um conjunto de dados sintético (mesmos nomes de coluna da
// planilha de produção, sem dado real de cliente).
//
// Existe porque `node --check` só enxerga sintaxe. Em 28/08/2026 a aba Drywall foi
// ao ar quebrada porque um patch aplicado com String.replace(from, to) transformou
// $$( (formatador de moeda) em $( — sintaxe válida, função inexistente. O lint
// (scripts/test-lint.js) pega esse caso por análise estática; este arquivo pega a
// classe maior: qualquer coisa que exploda ao montar a tela.
//
// Rodar: node scripts/test-render.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.error('FALHOU: bloco <script> não encontrado no index.html'); process.exit(1); }
const code = m[1];

// ── DOM simulado ───────────────────────────────────────────
const els = {};
function mkEl(id) {
  if (els[id]) return els[id];
  const el = {
    id, innerHTML: '', outerHTML: '', textContent: '', value: '', disabled: false,
    options: [], selectedIndex: -1, files: [], checked: false, scrollLeft: 0, offsetWidth: 800,
    style: new Proxy({}, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => (t[k] = v, true) }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {}, children: [], parentNode: null,
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, remove() {},
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() {},
    setAttribute() {}, getAttribute: () => null, scrollIntoView() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    getContext: () => ({}),          // canvas dos gráficos (Chart.js está stubado)
    querySelector: () => null, querySelectorAll: () => [],
    animate: () => ({ finished: Promise.resolve() }),
  };
  return (els[id] = el);
}
const doc = {
  getElementById: id => mkEl(id),
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => mkEl('_tmp' + Math.random()),
  addEventListener() {}, removeEventListener() {},
  body: mkEl('body'), documentElement: mkEl('html'), cookie: '',
};

const noop = () => {};
const sandbox = {
  document: doc,
  window: {
    addEventListener: noop, removeEventListener: noop, open: noop, print: noop,
    matchMedia: () => ({ matches: false, addListener: noop, addEventListener: noop }),
    location: { href: '', reload: noop }, innerWidth: 1200, scrollTo: noop,
  },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  navigator: { userAgent: 'node', serviceWorker: { register: () => Promise.resolve() } },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  Chart: Object.assign(function () { return { destroy: noop, update: noop, resize: noop }; }, { register: noop }),
  ChartDataLabels: {},                       // plugin carregado por <script src> na página real
  alert: noop, confirm: () => true, prompt: () => null,
  setTimeout: noop, setInterval: noop, clearTimeout: noop, clearInterval: noop,
  requestAnimationFrame: noop, getComputedStyle: () => ({ getPropertyValue: () => '' }),
  console,
};

const nomes = Object.keys(sandbox);
const run = new Function(...nomes, '__export', code +
  '\n__export({ renderAll, renderTab1, renderTab2, renderDrywall, renderObrasDrywall,' +
  ' renderClientesTable, renderInsurance, renderUsuarios, renderCloseForm, renderFinObraDetail,' +
  ' renderDetalhada, obraDetailHTML, invoiceHTML, showInsSub, showObrasSub,' +
  ' dwToggleServ, openDwLanc, openDwServ, dwToggleCli, openDwCli,' +
  ' setDB:v=>{DB=v}, getPROC:()=>PROC,' +
  ' set:(k,v)=>{ if(k==="SEL_ADDR")SEL_ADDR=v; if(k==="SEL_FIN_ADDR")SEL_FIN_ADDR=v;' +
  ' if(k==="SEL_ADDR_T4")SEL_ADDR_T4=v; if(k==="DW_DATA")DW_DATA=v; if(k==="DW_MES")DW_MES=v;' +
  ' if(k==="DW_CLI_MES")DW_CLI_MES=v; if(k==="OBRAS_SUB")OBRAS_SUB=v; } });');

const api = {};
run(...nomes.map(k => sandbox[k]), o => Object.assign(api, o));

// ── fixture: mesmos nomes de coluna da planilha, dados inventados ──
const DB = {
  lastUpdated: '2026-08-28 10:00:00',
  obras: [
    { _row: 2, 'Endereço': '4 Tara rd, Essex', 'Nome do Cliente': 'Andrew B', 'Contato': '555-0100',
      'Escopo': 'Banheiro completo', 'Orçamento': 6240, 'Data Início Prevista': '2026-07-01',
      'Data Fim Prevista': '2026-08-01', 'Link Fotos Antes': 'http://drive/antes', 'Finalizada': 'Não',
      'Data Finalização': '', 'Link Fotos Depois': '' },
    { _row: 3, 'Endereço': '66 Knotty way Belmont NH', 'Nome do Cliente': '', 'Contato': '',
      'Escopo': '', 'Orçamento': '', 'Data Início Prevista': '', 'Data Fim Prevista': '',
      'Link Fotos Antes': '', 'Finalizada': 'Sim', 'Data Finalização': '2026-01-10', 'Link Fotos Depois': '' },
  ],
  labor: [
    { _row: 2, 'Carimbo de data/hora': '2026-08-26 18:00:00', 'Endereço da obra': '4 Tara rd, Essex',
      'Nome do funcionário': 'João La Pastina', 'Hora de entrada': '08:00', 'Hora de saída': '17:00',
      'Comprou materiais hoje?': 'Sim', 'Valor total gasto': 45, 'Quem pagou?': 'Funcionário',
      'Foto do recibo (se aplicável)': 'http://drive/recibo1',
      'Algum material é necessário para amanhã?': '', 'Observações / Sugestões (Opcional, para feedback espontâneo)': '',
      'Endereço de email': 'joao@x.com', 'Horas tabalhadas': 8 },
    { _row: 3, 'Carimbo de data/hora': '2026-08-27 18:00:00', 'Endereço da obra': '14 Bradford road Hamilton',
      'Nome do funcionário': 'Leandro Venâncio', 'Hora de entrada': '07:30', 'Hora de saída': '16:30',
      'Comprou materiais hoje?': 'Não', 'Valor total gasto': '', 'Quem pagou?': '',
      'Foto do recibo (se aplicável)': '', 'Algum material é necessário para amanhã?': '',
      'Observações / Sugestões (Opcional, para feedback espontâneo)': '', 'Endereço de email': 'l@x.com',
      'Horas tabalhadas': 8 },
  ],
  materials: [
    { _row: 2, 'Carimbo de data/hora': '2026-08-26 12:00:00', 'Data da Compra': '2026-08-26',
      'Endereço da obra': '4 Tara rd, Essex', 'Descrição dos Itens': 'Porcelanato',
      'Valor Total Pago ($)': 1200, 'Anexar Comprovante/NF': 'http://drive/nf1',
      'Observações (Opcional)': '', 'Selecione a empresa': 'Home Depot',
      'É um custo extra para o cliente pagar?': 'Não', 'Valor Cobrado do Cliente ($)': '' },
    { _row: 3, 'Carimbo de data/hora': '2026-08-27 12:00:00', 'Data da Compra': '2026-08-27',
      'Endereço da obra': '4 Tara rd, Essex', 'Descrição dos Itens': 'Nicho extra',
      'Valor Total Pago ($)': 180, 'Anexar Comprovante/NF': '', 'Observações (Opcional)': '',
      'Selecione a empresa': 'Lowes', 'É um custo extra para o cliente pagar?': 'Sim',
      'Valor Cobrado do Cliente ($)': 300 },
  ],
  subcontractors: [
    { _row: 2, 'Carimbo de data/hora': '2026-08-20 09:00:00', 'Finalidade do subcontrato': 'Obra',
      'Endereço da obra': '4 Tara rd, Essex', 'Data de conclusão': '2026-08-22', 'Tipo de serviço': 'Plumbing',
      'Descrição do serviço': 'Troca de tubulação', 'Empresa Subcontratada': 'ACME Plumbing',
      'Contato do Subcontratado': '555-0200', 'Valor do serviço': 900, 'Status pagamento': 'Pago',
      'Anexar invoice': 'http://drive/inv1' },
  ],
  clients: [
    { _row: 2, 'Carimbo de data/hora': '2026-07-01 09:00:00', 'Nome do Cliente': 'Andrew B',
      'Contato do Cliente': '555-0100', 'Empresa do Cliente': 'Cabinet by Design',
      'Email do Cliente': 'andrew@x.com', 'Observação': '' },
  ],
  ajustes: [
    { _row: 2, 'Carimbo de data/hora': '2026-08-26 20:00:00', 'Nome do funcionário': 'João La Pastina',
      'Semana': '2026-08-23', 'Bonificação': 50, 'Justificativa Bonificação': 'Hora extra',
      'Desconto': 0, 'Justificativa Desconto': '' },
  ],
  funcionarios: [
    { _row: 2, nome: 'João La Pastina', rate: 25, temSenha: true },
    { _row: 3, nome: 'Leandro Venâncio', rate: 23, temSenha: true },
  ],
  rateHistory: [
    { _row: 2, nome: 'João La Pastina', rate: 25, desde: '2026-08-02' },
    { _row: 3, nome: 'Leandro Venâncio', rate: 23, desde: '2026-08-02' },
  ],
  subProfiles: [
    { _row: 2, 'Carimbo de data/hora': '2026-07-10 09:00:00', 'Owner Name': 'Bob R',
      'Company Name': 'ACME Plumbing', 'Company Address': '1 Main St', 'Email': 'bob@x.com',
      'Phone': '555-0200', 'COI Policy Number': 'P-123', 'Insurance Expiration': '2026-12-31',
      'COI URL': 'http://drive/coi', 'EIN': '12-3456789', 'W9 URL': 'http://drive/w9',
      'Alerted30': '', 'AlertedExpired': '' },
    { _row: 3, 'Carimbo de data/hora': '2026-07-11 09:00:00', 'Owner Name': 'Vencido S',
      'Company Name': 'Old Crew', 'Company Address': '2 Oak St', 'Email': 'old@x.com',
      'Phone': '555-0300', 'COI Policy Number': 'P-999', 'Insurance Expiration': '2026-01-31',
      'COI URL': '', 'EIN': '', 'W9 URL': '', 'Alerted30': 'x', 'AlertedExpired': 'x' },
  ],
  drywall: [
    { _row: 2, ts: '2026-08-12 09:00:00', data: '2026-08-12', cliente: 'Maria Silva', addr: '12 Oak St',
      valorCobrado: '800', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 200, obs: '' },
    { _row: 3, ts: '2026-08-12 09:00:00', data: '2026-08-12', cliente: 'Joe Brown', addr: '40 Pine Ave',
      valorCobrado: '600', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 200, obs: '' },
    { _row: 4, ts: '2026-08-12 09:00:00', data: '2026-08-12', cliente: '', addr: '8 Elm Rd',
      valorCobrado: '950', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 200, obs: 'sem cliente' },
    { _row: 5, ts: '2026-08-13 09:00:00', data: '2026-08-13', cliente: 'Maria Silva', addr: '77 Ash Way',
      valorCobrado: '450', pessoa: 'Ana', companhia: 'DW Crew', diaria: 180, obs: '' },
  ],
};

// ── execução ───────────────────────────────────────────────
let fails = 0;
const check = (nome, cond, extra) => {
  if (cond) console.log('  ok  ' + nome);
  else { fails++; console.log('  FALHOU  ' + nome + (extra ? '\n          ' + extra : '')); }
};
const roda = (nome, fn, verificar) => {
  try {
    const r = fn();
    if (verificar) { const msg = verificar(r); check(nome, msg === true, typeof msg === 'string' ? msg : undefined); }
    else check(nome, true);
  } catch (e) {
    fails++;
    console.log('  FALHOU  ' + nome + ' lançou: ' + e.message);
  }
};
const semLixo = id => {
  const h = els[id] ? els[id].innerHTML : '';
  if (!h) return 'tela ' + id + ' ficou vazia';
  if (h.includes('undefined')) return 'tela ' + id + ' contém "undefined"';
  if (h.includes('NaN')) return 'tela ' + id + ' contém "NaN"';
  return true;
};

api.setDB(DB);
api.set('DW_DATA', '2026-08-12');
api.set('DW_MES', '2026-08');
api.set('DW_CLI_MES', '2026-08');

// 1. o encadeamento inteiro do app
roda('renderAll() — pinta o app inteiro sem erro', () => api.renderAll());

// 2. cada tela, verificando que produziu conteúdo íntegro
roda('Controle de Obras (obra selecionada)', () => { api.set('SEL_ADDR', '4 Tara rd, Essex'); api.renderTab1(); }, () => semLixo('t1body'));
roda('Controle de Horas', () => api.renderTab2(), () => semLixo('gerBody'));
roda('Insurance & W9 — Control', () => { api.showInsSub('control'); }, () => semLixo('insBody'));
roda('Insurance & W9 — Registry', () => { api.showInsSub('registry'); }, () => semLixo('insBody'));
roda('Usuários', () => api.renderUsuarios(), () => semLixo('usrBody'));
roda('Drywall — lançamentos + clientes', () => api.renderDrywall(), () => semLixo('t8body'));
roda('Controle de Obras — sub-aba Drywall', () => api.renderObrasDrywall(), () => semLixo('st1dw'));
roda('Fechar Obra — formulário', () => { api.set('SEL_ADDR_T4', '4 Tara rd, Essex'); api.renderCloseForm(); }, () => semLixo('t4CloseArea'));
roda('Obras Finalizadas — detalhe', () => { api.set('SEL_FIN_ADDR', '66 Knotty way Belmont NH'); api.renderFinObraDetail(); }, () => semLixo('t4DetailBody'));

// 3. conteúdo específico das funcionalidades novas
roda('Drywall — tabela de clientes agrega por cliente', () => els['t8body'].innerHTML, h =>
  (h.includes('Clientes de drywall') && h.includes('(sem cliente)') && /Maria Silva[\s\S]{0,400}?<td>2<\/td>/.test(h))
  || 'tabela de clientes não agregou como esperado');
roda('Obras Finalizadas — oferece Reabrir obra', () => els['t4DetailBody'].innerHTML, h =>
  h.includes('Reabrir obra') || 'botão de reabrir não apareceu');
roda('obra ativa — oferece Encerrar obra', () => api.obraDetailHTML('4 Tara rd, Essex', { donut: 'd', budget: 'b', bar: 'r' }), h =>
  (h.includes('Encerrar obra') && h.includes('Resultado Financeiro') && !h.includes('Cadastro incompleto'))
  || 'obra ativa não trouxe o botão de encerrar');
roda('obra finalizada — NÃO oferece Encerrar obra', () => api.obraDetailHTML('66 Knotty way Belmont NH', { donut: 'd', budget: 'b', bar: 'r' }), h =>
  (!h.includes('Encerrar obra') && h.includes('Completar cadastro'))
  || 'obra finalizada não deveria ter botão de encerrar');
roda('obra sem cadastro — oferece Completar cadastro', () => api.obraDetailHTML('14 Bradford road Hamilton', { donut: 'd', budget: 'b', bar: 'r' }), h =>
  (h.includes('Completar cadastro') && h.includes('Encerrar obra') && !h.includes('undefined'))
  || 'obra sem cadastro não trouxe o banner de completar');
roda('invoice do cliente monta', () => api.invoiceHTML('4 Tara rd, Essex'), h =>
  (h.length > 0 && !h.includes('undefined') && !h.includes('NaN')) || 'invoice saiu com lixo');

// ── editar/excluir lançamentos e serviços de drywall ──
roda('Obras Drywall — serviço fechado não mostra os lançamentos', () => els['st1dw'].innerHTML, h =>
  (h.includes('Editar serviço') && h.includes('Excluir serviço inteiro') && !h.includes('Editar lançamento'))
  || 'a linha fechada não deveria listar lançamentos');

roda('Obras Drywall — abrir o serviço lista os lançamentos com editar/excluir', () => {
  api.dwToggleServ('8 Elm Rd');   // 1 lançamento do Carlos em 12/08
  return els['st1dw'].innerHTML;
}, h => (h.includes('Editar lançamento') && h.includes('Excluir lançamento') && h.includes('Carlos')
  && !h.includes('undefined') && !h.includes('NaN')) || 'abrir o serviço não trouxe os lançamentos');

roda('Obras Drywall — clicar de novo fecha o serviço', () => {
  api.dwToggleServ('8 Elm Rd');
  return els['st1dw'].innerHTML;
}, h => !h.includes('Editar lançamento') || 'o serviço deveria ter fechado');

roda('editor de lançamento carrega os dados da linha', () => {
  api.openDwLanc(2);              // 12 Oak St, Carlos, $200, 12/08
  return { data: els['dwl_data'].value, pessoa: els['dwl_pessoa'].value,
    diaria: els['dwl_diaria'].value, serv: els['dwl_serv'].innerHTML, lista: els['dwPessoasList'].innerHTML };
}, v => (v.data === '2026-08-12' && v.pessoa === 'Carlos' && String(v.diaria) === '200'
  && v.serv.includes('selected') && v.serv.includes('12 Oak St') && v.lista.includes('Ana'))
  || 'campos do editor de lançamento vieram errados: ' + JSON.stringify(v).slice(0, 200));

roda('editor de serviço carrega cliente/endereço/valor e avisa quantas linhas mexe', () => {
  api.openDwServ('12 Oak St');
  return { cli: els['dws_cliente'].value, addr: els['dws_addr'].value,
    val: els['dws_valor'].value, nota: els['dwsNote'].textContent };
}, v => (v.cli === 'Maria Silva' && v.addr === '12 Oak St' && String(v.val) === '800'
  && /1 lançamento/.test(v.nota))
  || 'campos do editor de serviço vieram errados: ' + JSON.stringify(v).slice(0, 200));

roda('editor de serviço de um endereço sem cliente abre vazio, sem "undefined"', () => {
  api.openDwServ('8 Elm Rd');
  return els['dws_cliente'].value + '|' + els['dws_addr'].value;
}, v => v === '|8 Elm Rd' || 'esperado cliente vazio, veio: ' + v);

// ── tabela "Clientes de drywall": renomear e excluir ──
roda('Clientes — cliente nomeado tem renomear e excluir; grupo sem cliente só excluir', () => {
  api.renderDrywall();
  return els['t8body'].innerHTML;
}, h => {
  // recortar a partir do título: o formulário acima lista "endereço — cliente"
  // no dropdown de serviço, e procurar no HTML inteiro pegaria esse trecho
  const i = h.indexOf('Clientes de drywall');
  if (i < 0) return 'tabela de clientes não foi renderizada';
  const linhas = h.slice(i).split('<tr class="dw-serv-row').slice(1);
  const semCli = linhas.find(l => l.includes('(sem cliente)'));
  const comCli = linhas.find(l => l.includes('Maria Silva'));
  if (!semCli || !comCli) return 'não achei as linhas de cliente na tabela';
  if (!comCli.includes('Renomear cliente')) return 'cliente nomeado deveria ter o botão de renomear';
  if (semCli.includes('Renomear cliente')) return 'grupo "(sem cliente)" NÃO pode ter renomear';
  if (!semCli.includes('Excluir os serviços')) return 'grupo sem cliente deveria ter excluir';
  return true;
});

roda('Clientes — abrir o cliente lista os serviços dele com editar/excluir', () => {
  api.dwToggleCli('Maria Silva');   // 12 Oak St + 77 Ash Way
  return els['t8body'].innerHTML;
}, h => (h.includes('Editar serviço') && h.includes('12 Oak St') && h.includes('77 Ash Way')
  && !h.includes('undefined') && !h.includes('NaN')) || 'abrir o cliente não trouxe os serviços');

roda('Clientes — clicar de novo fecha', () => {
  api.dwToggleCli('Maria Silva');
  return els['t8body'].innerHTML;
}, h => !h.includes('Editar serviço') || 'o cliente deveria ter fechado');

roda('renomear cliente avisa quantos lançamentos serão alterados', () => {
  api.openDwCli('Maria Silva');     // 2 lançamentos (rows 2 e 5)
  return { nome: els['dwc_nome'].value, nota: els['dwcNote'].textContent };
}, v => (v.nome === 'Maria Silva' && /2 lançamentos/.test(v.nota) && !/undefined/.test(v.nota))
  || 'aviso do renomear veio errado: ' + JSON.stringify(v));

console.log(fails ? '\n' + fails + ' falha(s).' : '\nrender ok.');
process.exit(fails ? 1 : 0);
