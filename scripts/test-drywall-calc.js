// Testa o bloco puro de cálculo do drywall extraído do index.html.
// Rodar: node scripts/test-drywall-calc.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = /\/\/ ══ DRYWALL — CÁLCULO[\s\S]*?\/\/ ══ FIM DRYWALL — CÁLCULO/.exec(html);
if (!m) {
  console.error('FALHOU: bloco "DRYWALL — CÁLCULO" não encontrado no index.html');
  process.exit(1);
}
const api = {};
new Function('__out', m[0] + '\nObject.assign(__out,{dwNorm,dwRound2,dwLancamentos,dwServicos,dwPessoas,dwServicosDoMes,dwTotais,dwClientes});')(api);
const { dwLancamentos, dwServicos, dwPessoas, dwServicosDoMes, dwTotais, dwClientes } = api;

let n = 0;
const t = (nome, fn) => { fn(); n++; console.log('  ok  ' + nome); };
function eqAddr(a, b) { return String(a).trim().toLowerCase().replace(/\s+/g, ' ') === String(b).trim().toLowerCase().replace(/\s+/g, ' '); }

// Fixture: Carlos ($200/dia) em 3 endereços no dia 12; volta ao 8 Elm Rd no dia 13.
const base = [
  { _row: 2, data: '2026-08-12', cliente: 'Maria Silva', addr: '12 Oak St',   valorCobrado: '800', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 200 },
  { _row: 3, data: '2026-08-12', cliente: 'Joe Brown',   addr: '40 Pine Ave', valorCobrado: '600', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 200 },
  { _row: 4, data: '2026-08-12', cliente: 'Ana Costa',   addr: '8 Elm Rd',    valorCobrado: '950', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 200 },
  { _row: 5, data: '2026-08-13', cliente: 'Ana Costa',   addr: '8 Elm Rd',    valorCobrado: '',    pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 200 },
];

t('rateia a diária entre os 3 endereços do dia e fecha exatamente no valor da diária', () => {
  const l = dwLancamentos(base).filter(x => x.data === '2026-08-12');
  assert.strictEqual(l.length, 3);
  l.forEach(x => assert.strictEqual(x.divisor, 3));
  const soma = l.reduce((s, x) => s + x.custo, 0);
  assert.strictEqual(Math.round(soma * 100) / 100, 200, 'a soma do rateio deve ser exatamente 200');
  const custos = l.map(x => x.custo).sort((a, b) => a - b);
  assert.deepStrictEqual(custos, [66.66, 66.67, 66.67]);
});

t('dia com um único endereço recebe a diária inteira', () => {
  const l = dwLancamentos(base).filter(x => x.data === '2026-08-13');
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].custo, 200);
});

t('4º endereço no mesmo dia reajusta os quatro para $50', () => {
  const raw = base.concat([{ _row: 6, data: '2026-08-12', cliente: 'Pedro Lima', addr: '55 Main St', valorCobrado: '700', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 200 }]);
  const l = dwLancamentos(raw).filter(x => x.data === '2026-08-12');
  assert.strictEqual(l.length, 4);
  l.forEach(x => assert.strictEqual(x.custo, 50));
});

// Nota sobre os centavos: no dia 12 o grupo do Carlos tem 3 linhas (_row 2,3,4).
// 20000 centavos / 3 = 6666 com resto 2 -> as DUAS primeiras recebem o centavo extra.
// Logo _row 2 e 3 custam 66.67 e _row 4 (8 Elm Rd) custa 66.66.
t('receita não soma quando o serviço tem várias diárias', () => {
  const s = dwServicos(base).find(x => x.addr === '8 Elm Rd');
  assert.strictEqual(s.receita, 950, 'receita deve continuar 950, não 1900');
  assert.strictEqual(s.custo, 266.66, '66.66 (1/3 do dia 12) + 200 (dia 13 sozinho)');
  assert.strictEqual(s.lucro, 683.34);
});

t('serviço sem execução aparece com custo 0 e lucro igual à receita', () => {
  const raw = base.concat([{ _row: 7, data: '2026-08-14', cliente: 'Novo Cliente', addr: '99 New St', valorCobrado: '500', pessoa: '', companhia: '', diaria: 0 }]);
  const s = dwServicos(raw).find(x => x.addr === '99 New St');
  assert.strictEqual(s.custo, 0);
  assert.strictEqual(s.receita, 500);
  assert.strictEqual(s.lucro, 500);
});

t('endereço com caixa/espaçamento diferente cai no mesmo serviço', () => {
  const raw = base.concat([{ _row: 8, data: '2026-08-14', cliente: 'Maria Silva', addr: '  12 oak st ', valorCobrado: '', pessoa: 'Miguel', companhia: 'Drywall Pro', diaria: 180 }]);
  const servicos = dwServicos(raw);
  assert.strictEqual(servicos.filter(s => eqAddr(s.addr, '12 Oak St')).length, 1, 'não pode duplicar o serviço');
  const s = servicos.find(x => eqAddr(x.addr, '12 Oak St'));
  assert.strictEqual(s.receita, 800, 'receita continua a do 1º lançamento');
  assert.strictEqual(s.custo, Math.round((66.67 + 180) * 100) / 100);
});

t('pessoas saem do histórico com a diária mais recente', () => {
  const raw = base.concat([{ _row: 9, data: '2026-09-01', cliente: 'X', addr: '1 A St', valorCobrado: '100', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 220 }]);
  const p = dwPessoas(raw);
  const carlos = p.find(x => x.nome === 'Carlos');
  assert.strictEqual(carlos.diaria, 220, 'deve usar a diária mais recente');
  assert.strictEqual(carlos.companhia, 'Drywall Pro');
});

t('diária antiga é preservada nos lançamentos passados', () => {
  const raw = base.concat([{ _row: 9, data: '2026-09-01', cliente: 'X', addr: '1 A St', valorCobrado: '100', pessoa: 'Carlos', companhia: 'Drywall Pro', diaria: 220 }]);
  const l = dwLancamentos(raw).filter(x => x.data === '2026-08-13');
  assert.strictEqual(l[0].custo, 200, 'lançamento de agosto mantém a diária de 200');
});

t('serviços do mês filtram pelo mês de início e somam os totais', () => {
  const servicos = dwServicosDoMes(base, '2026-08');
  assert.strictEqual(servicos.length, 3);
  const tot = dwTotais(servicos);
  assert.strictEqual(tot.receita, 2350);
  assert.strictEqual(tot.custo, 400, 'as 2 diárias do Carlos somam exatamente 400');
  assert.strictEqual(tot.lucro, 1950);
});

t('serviço iniciado em agosto com diária em setembro continua em agosto, com custo inteiro', () => {
  const raw = base.concat([{ _row: 10, data: '2026-09-02', cliente: 'Ana Costa', addr: '8 Elm Rd', valorCobrado: '', pessoa: 'Miguel', companhia: 'Drywall Pro', diaria: 180 }]);
  const ago = dwServicosDoMes(raw, '2026-08');
  const s = ago.find(x => x.addr === '8 Elm Rd');
  assert.ok(s, 'o serviço deve continuar aparecendo em agosto');
  assert.strictEqual(s.custo, 446.66, '66.66 + 200 (agosto) + 180 (setembro, custo integral)');
  assert.strictEqual(dwServicosDoMes(raw, '2026-09').some(x => x.addr === '8 Elm Rd'), false);
});

// ── dwClientes: uma linha por cliente, somando os endereços dele ──

t('agrupa por cliente somando os serviços do mês', () => {
  const c = dwClientes(base, '2026-08');
  assert.strictEqual(c.length, 3, 'Maria, Joe e Ana');
  const ana = c.find(x => x.cliente === 'Ana Costa');
  assert.strictEqual(ana.servicos, 1);
  assert.strictEqual(ana.receita, 950);
  assert.strictEqual(ana.custo, 266.66);
  assert.strictEqual(ana.lucro, 683.34);
});

t('mesmo cliente em dois endereços vira uma linha só', () => {
  const raw = base.concat([
    { _row: 7, data: '2026-08-14', cliente: 'Ana Costa', addr: '99 Cedar Ln', valorCobrado: '400', pessoa: 'Miguel', companhia: 'Drywall Pro', diaria: 150 },
  ]);
  const ana = dwClientes(raw, '2026-08').find(x => x.cliente === 'Ana Costa');
  assert.strictEqual(ana.servicos, 2);
  assert.strictEqual(ana.receita, 1350, '950 + 400');
  assert.strictEqual(ana.custo, 416.66, '266.66 + 150');
  assert.strictEqual(ana.lucro, 933.34);
  assert.deepStrictEqual(ana.enderecos.slice().sort(), ['8 Elm Rd', '99 Cedar Ln']);
});

t('nome do cliente com caixa/espaçamento diferente cai no mesmo grupo', () => {
  const raw = base.concat([
    { _row: 7, data: '2026-08-14', cliente: 'ANA  costa', addr: '99 Cedar Ln', valorCobrado: '400', pessoa: 'Miguel', companhia: 'Drywall Pro', diaria: 150 },
  ]);
  const c = dwClientes(raw, '2026-08').filter(x => /ana/i.test(x.cliente));
  assert.strictEqual(c.length, 1, 'não pode virar dois clientes');
  assert.strictEqual(c[0].servicos, 2);
});

t('serviços sem cliente ficam num grupo próprio em vez de sumir do total', () => {
  const raw = base.concat([
    { _row: 7, data: '2026-08-14', cliente: '', addr: '99 Cedar Ln', valorCobrado: '400', pessoa: 'Miguel', companhia: 'Drywall Pro', diaria: 150 },
    { _row: 8, data: '2026-08-15', cliente: '', addr: '17 Birch St', valorCobrado: '300', pessoa: 'Miguel', companhia: 'Drywall Pro', diaria: 150 },
  ]);
  const c = dwClientes(raw, '2026-08');
  const sem = c.find(x => x.cliente === '');
  assert.ok(sem, 'deve existir um grupo para os serviços sem cliente');
  assert.strictEqual(sem.servicos, 2);
  assert.strictEqual(sem.receita, 700);
  const totC = dwTotais(c), totS = dwTotais(dwServicosDoMes(raw, '2026-08'));
  assert.strictEqual(totC.receita, totS.receita);
  assert.strictEqual(totC.custo, totS.custo);
});

t('o total por cliente bate exatamente com o total por serviço', () => {
  assert.deepStrictEqual(dwTotais(dwClientes(base, '2026-08')), dwTotais(dwServicosDoMes(base, '2026-08')));
});

t('ordena do cliente que mais rendeu para o que menos rendeu', () => {
  const r = dwClientes(base, '2026-08').map(x => x.receita);
  assert.deepStrictEqual(r, r.slice().sort((a, b) => b - a));
});

t('filtra pelo mês pedido', () => {
  assert.strictEqual(dwClientes(base, '2026-09').length, 0);
  assert.strictEqual(dwClientes(base, '2026-08').length, 3);
});

console.log('\n' + n + ' testes passaram.');
