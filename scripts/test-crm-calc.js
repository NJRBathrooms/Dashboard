// Bloco puro "CRM — CÁLCULO" do index.html: datas, idade da obra, sugestão de
// data de conclusão, possíveis duplicatas, montagem e filtro da lista.
//
// Os casos de duplicata são os reais da base (13/10/2026): o teste garante que
// os três pares duvidosos aparecem e que os falsos alarmes óbvios não.
//
// Rodar: node scripts/test-crm-calc.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bloco = /\/\/ ══ CRM — CÁLCULO[\s\S]*?\/\/ ══ FIM CRM — CÁLCULO ══/.exec(html);
if (!bloco) { console.error('FALHOU: bloco "CRM — CÁLCULO" não encontrado no index.html'); process.exit(1); }
const api = {};
new Function('__out', bloco[0] + '\nObject.assign(__out,{crmIso,crmDias,crmMeses,crmIdade,crmLev,crmFone,crmFmtFone,'
  + 'crmUltimoTrabalho,crmSugestaoData,crmDuplicatas,crmMontar,crmFiltrar});')(api);
const C = api;

let fails = 0;
const teste = (nome, fn) => {
  try { fn(); console.log('  ok  ' + nome); }
  catch (e) { fails++; console.log('  FALHOU  ' + nome + '\n          ' + e.message); }
};

// ── datas ──
teste('crmIso aceita os formatos da planilha', () => {
  assert.strictEqual(C.crmIso('2026/04/04 00:00:00'), '2026-04-04');
  assert.strictEqual(C.crmIso('2026-10-11'), '2026-10-11');
  assert.strictEqual(C.crmIso(new Date(2026, 9, 14, 23, 50)), '2026-10-14');
  assert.strictEqual(C.crmIso(''), '');
  assert.strictEqual(C.crmIso('lixo'), '');
});
teste('meses de calendário completos', () => {
  assert.strictEqual(C.crmMeses('2026-04-17', '2026-10-16'), 5);
  assert.strictEqual(C.crmMeses('2026-04-17', '2026-10-17'), 6);
  assert.strictEqual(C.crmMeses('2025-10-14', '2026-10-14'), 12);
});
teste('idade legível', () => {
  assert.strictEqual(C.crmIdade('2026-10-14', '2026-10-14'), 'hoje');
  assert.strictEqual(C.crmIdade('2026-10-13', '2026-10-14'), 'há 1 dia');
  assert.strictEqual(C.crmIdade('2026-09-20', '2026-10-14'), 'há 24 dias');
  assert.strictEqual(C.crmIdade('2026-04-01', '2026-10-14'), 'há 6 meses');
  assert.strictEqual(C.crmIdade('2025-10-14', '2026-10-14'), 'há 1 ano');
  assert.strictEqual(C.crmIdade('2024-08-01', '2026-10-14'), 'há 2 anos e 2 meses');
  assert.strictEqual(C.crmIdade('2026-12-01', '2026-10-14'), '', 'data no futuro deveria ficar em branco');
});
teste('telefone: 10 últimos dígitos, formatado', () => {
  assert.strictEqual(C.crmFone('+1 (603) 231-9002'), '6032319002');
  assert.strictEqual(C.crmFone('88 S Main St Laconia'), '');
  assert.strictEqual(C.crmFmtFone('6032319002'), '(603) 231-9002');
});

// ── último trabalho e sugestão de data ──
teste('último dia de trabalho por obra, ignorando caixa e espaços', () => {
  const m = C.crmUltimoTrabalho([
    { addr: '5 Linden Way Merrimack', dia: '2026-03-30' },
    { addr: '5  linden way merrimack', dia: '2026-04-01' },
    { addr: '5 Linden Way Merrimack', dia: '2026/03/15 10:00:00' },
    { addr: '', dia: '2026-04-02' },
  ]);
  assert.strictEqual(m['5 linden way merrimack'], '2026-04-01');
  assert.strictEqual(Object.keys(m).length, 1);
});
const fechadaEm = (dtFinal, extra = {}) => ({ finalizada: true, dtFinal, conferida: false, ...extra });
teste('fechada em lote: sugere o último dia de trabalho', () => {
  assert.deepStrictEqual(C.crmSugestaoData(fechadaEm('2026-10-11'), '2026-04-01', {}), { tipo: 'sugerida', data: '2026-04-01' });
});
teste('até 14 dias de diferença é normal (acabamento, limpeza)', () => {
  assert.strictEqual(C.crmSugestaoData(fechadaEm('2026-08-25'), '2026-08-11', {}), null);
  assert.ok(C.crmSugestaoData(fechadaEm('2026-08-26'), '2026-08-11', {}));
});
teste('conferida pelo Nilmar: a sugestão não volta', () => {
  assert.strictEqual(C.crmSugestaoData(fechadaEm('2026-10-11', { conferida: true }), '2026-04-01', {}), null);
});
teste('sem horas e data repetida em 5+ obras: pede a data à mão', () => {
  assert.deepStrictEqual(C.crmSugestaoData(fechadaEm('2026-10-11'), '', { '2026-10-11': 38 }), { tipo: 'manual' });
  assert.strictEqual(C.crmSugestaoData(fechadaEm('2026-08-25'), '', { '2026-08-25': 4 }), null);
});
teste('obra em andamento não tem sugestão', () => {
  assert.strictEqual(C.crmSugestaoData({ finalizada: false, dtFinal: '', conferida: false }, '2026-04-01', {}), null);
});

// ── duplicatas ──
const fichas = [
  { id: 'C001', nome: 'Paul kadilak', fone: '6174621104' },
  { id: 'C024', nome: 'Hubley', fone: '7744057350' },
  { id: 'C027', nome: 'Hubley Painting (kamil)', fone: '' },
  { id: 'C026', nome: 'Built well - bob', fone: '5083281586' },
  { id: 'C028', nome: 'Dave Builtwell', fone: '' },
  { id: 'C031', nome: 'John Kadlak', fone: '' },
  { id: 'C020', nome: 'Kate', fone: '7173431312' },
  { id: 'C014', nome: 'Kate - Chris Ronche', fone: '6033936064' },
  { id: 'C008', nome: 'Eric', fone: '9788355366' },
  { id: 'C029', nome: 'Eric Erickson', fone: '' },
  { id: 'C017', nome: 'Eric Johnson', fone: '5084988550' },
  { id: 'C022', nome: 'Cris', fone: '6036898563' },
  { id: 'C005', nome: 'Cris Cahil', fone: '6032319002' },
  { id: 'C015', nome: 'Michael European builders', fone: '7706305997' },
  { id: 'C030', nome: 'Brandon laroche', fone: '' },
  // falso alarme visto no ensaio com a base real: sobrenomes a 1 letra, pessoas diferentes
  { id: 'C032', nome: 'Greg stern', fone: '' },
  { id: 'C011', nome: 'Juliana Stein', fone: '6175713484' },
];
const D = C.crmDuplicatas(fichas);
const par = (a, b) => (D[a] || []).some(x => x.id === b) && (D[b] || []).some(x => x.id === a);
teste('Hubley e Hubley Painting (kamil) aparecem como possível duplicata', () => assert.ok(par('C024', 'C027')));
teste('Dave Builtwell e Built well - bob aparecem', () => assert.ok(par('C026', 'C028')));
teste('John Kadlak e Paul kadilak aparecem (1 letra de diferença)', () => assert.ok(par('C001', 'C031')));
teste('as duas Kate NÃO (telefones diferentes)', () => assert.ok(!par('C020', 'C014')));
teste('os três Eric NÃO (primeiro nome curto)', () => {
  assert.ok(!par('C008', 'C029')); assert.ok(!par('C008', 'C017')); assert.ok(!par('C029', 'C017'));
});
teste('Cris e Cris Cahil NÃO (telefones diferentes)', () => assert.ok(!par('C022', 'C005')));
teste('European builders e Builtwell NÃO', () => assert.ok(!par('C015', 'C028')));
teste('ficha sem semelhança nenhuma fica sem aviso', () => assert.strictEqual((D['C030'] || []).length, 0));
teste('Greg stern e Juliana Stein NÃO (5 letras com 1 de diferença é ruído)', () => assert.ok(!par('C032', 'C011')));
teste('mesmo telefone em duas fichas é duplicata certa', () => {
  const d2 = C.crmDuplicatas([{ id: 'A', nome: 'Joe', fone: '1111111111' }, { id: 'B', nome: 'Totally Different', fone: '1111111111' }]);
  assert.strictEqual((d2.A || []).length, 1);
});

// ── montagem da lista ──
const cli = (id, nome, tipo, origem, contato = '') => ({ id, nome, tipo, origem, contato, empresa: '', email: '', obs: '', canal: '' });
const ob = (addr, idCliente, dtFinal, extra = {}) => ({ addr, idCliente, cliente: '', contato: '', finalizada: !!dtFinal,
  dtFinal: dtFinal || '', dtInicio: '', conferida: false, ...extra });
const M = C.crmMontar({
  clientes: [
    cli('C005', 'Cris Cahil', 'Empreiteiro', 'Confirmado', '+1 (603) 231-9002'),
    cli('C007', 'Varsha Braham', 'Cliente', 'Nilmar', '(508) 341-5700'),
    cli('C099', 'Sem Obras', 'Cliente', 'Nilmar'),
    cli('', 'Sem ID ainda', 'Cliente', ''),
  ],
  obras: [
    ob('146 Nartoff rd', 'C005', '2026-06-06'),
    ob('74 B Averill rd', 'C005', '2026-04-17'),
    ob('25 Chapel Hill Rd', 'C005', ''),                        // em andamento
    ob('2 Brenda lane', 'C005', '2026-10-11'),                  // lote: último trabalho em junho
    ob('180 Stone School Rd', 'C007', '2026-06-13'),
    ob('66 Knotty way', '', '2026-06-18', { cliente: '' }),
    ob('640 Washington st', 'C999', '2026-10-11', { cliente: 'Não sei' }),   // ID que não existe
  ],
  ultimo: { '2 brenda lane': '2026-06-18' },
  hoje: '2026-10-14',
});
const cris = M.fichas.find(f => f.id === 'C005');
teste('obras do cliente da mais antiga para a mais nova, em andamento por último', () => {
  assert.deepStrictEqual(cris.obras.map(o => o.addr), ['74 B Averill rd', '146 Nartoff rd', '2 Brenda lane', '25 Chapel Hill Rd']);
});
teste('obra do lote é ordenada e contada pela data sugerida', () => {
  const o = cris.obras.find(x => x.addr === '2 Brenda lane');
  assert.strictEqual(o.conclusao, '2026-06-18');
  assert.strictEqual(o.idade, 'há 3 meses');
  assert.strictEqual(o.sugestao.tipo, 'sugerida');
});
teste('clientes ordenados pela obra mais antiga', () => {
  assert.deepStrictEqual(M.fichas.map(f => f.id), ['C005', 'C007', 'C099']);
});
teste('ficha sem ID ainda não entra na lista', () => assert.ok(!M.fichas.some(f => f.nome === 'Sem ID ainda')));
teste('sem ID ou com ID inexistente → "a identificar"', () => {
  assert.deepStrictEqual(M.aIdentificar.map(o => o.addr).sort(), ['640 Washington st', '66 Knotty way']);
});
teste('contagens do topo', () => {
  assert.strictEqual(M.contagem.aConfirmar, 1);     // só a Cris não foi revisada
  assert.strictEqual(M.contagem.aIdentificar, 2);
  assert.strictEqual(M.contagem.datas, 1);          // a 2 Brenda lane (a 640 tem ID inválido e não tem horas, mas só 1 obra no dia)
});

// ── filtro e busca ──
teste('"todos" separa empreiteiros e clientes', () => {
  const v = C.crmFiltrar(M, 'todos', '');
  assert.deepStrictEqual(v.empreiteiros.map(f => f.id), ['C005']);
  assert.deepStrictEqual(v.clientes.map(f => f.id), ['C007', 'C099']);
  assert.strictEqual(v.aIdentificar.length, 2);
});
teste('"a confirmar" mostra só o que o Nilmar não revisou', () => {
  const v = C.crmFiltrar(M, 'confirmar', '');
  assert.deepStrictEqual(v.empreiteiros.concat(v.clientes).map(f => f.id), ['C005']);
  assert.strictEqual(v.aIdentificar.length, 0);
});
teste('"datas a conferir" mostra só quem tem data suspeita', () => {
  const v = C.crmFiltrar(M, 'datas', '');
  assert.deepStrictEqual(v.empreiteiros.map(f => f.id), ['C005']);
  assert.strictEqual(v.clientes.length, 0);
});
teste('"a identificar" esconde as fichas', () => {
  const v = C.crmFiltrar(M, 'identificar', '');
  assert.strictEqual(v.empreiteiros.length + v.clientes.length, 0);
  assert.strictEqual(v.aIdentificar.length, 2);
});
teste('busca por nome, telefone e endereço', () => {
  assert.deepStrictEqual(C.crmFiltrar(M, 'todos', 'varsha').clientes.map(f => f.id), ['C007']);
  assert.deepStrictEqual(C.crmFiltrar(M, 'todos', '231-9002').empreiteiros.map(f => f.id), ['C005']);
  assert.deepStrictEqual(C.crmFiltrar(M, 'todos', 'nartoff').empreiteiros.map(f => f.id), ['C005']);
  assert.deepStrictEqual(C.crmFiltrar(M, 'todos', 'knotty').aIdentificar.map(o => o.addr), ['66 Knotty way']);
});

console.log(fails ? '\n' + fails + ' falha(s).' : '\ncálculo do CRM ok.');
process.exit(fails ? 1 : 0);
