// Descontos programados: parcelamento de dívida do funcionário.
//
// Regras que estes testes travam:
//   - as parcelas fecham no centavo (soma == total, sempre);
//   - a semana de cada parcela é FIXA — pular uma não empurra as seguintes;
//   - parcela de semana passada e não marcada conta como ATRASADA;
//   - o saldo só desce quando a parcela é marcada como descontada.
//
// Rodar: node scripts/test-desconto-prog.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bloco = /\/\/ ══ DESCONTOS PROGRAMADOS — CÁLCULO[\s\S]*?\/\/ ══ FIM DESCONTOS PROGRAMADOS — CÁLCULO ══/.exec(html);
if (!bloco) { console.error('FALHOU: bloco de cálculo não encontrado no index.html'); process.exit(1); }
const api = {};
new Function('__out', bloco[0] + '\nObject.assign(__out,{dpParcelas,dpSemanaMais,dpIndice,dpPlano,dpDaSemana});')(api);
const { dpParcelas, dpSemanaMais, dpIndice, dpPlano, dpDaSemana } = api;

let fails = 0;
const teste = (nome, fn) => {
  try { fn(); console.log('  ok  ' + nome); }
  catch (e) { fails++; console.log('  FALHOU  ' + nome + '\n          ' + e.message); }
};
const soma = a => Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100;

// ── parcelas fecham no centavo ──
teste('o caso do Leandro: $529 em 5 parcelas de $105,80', () => {
  assert.deepStrictEqual(dpParcelas(529, 5), [105.8, 105.8, 105.8, 105.8, 105.8]);
  assert.strictEqual(soma(dpParcelas(529, 5)), 529);
});

teste('divisão inexata fecha no centavo, com o resto nas primeiras', () => {
  assert.deepStrictEqual(dpParcelas(100, 3), [33.34, 33.33, 33.33]);
  assert.strictEqual(soma(dpParcelas(100, 3)), 100);
});

teste('nunca sobra nem falta centavo, em nenhuma combinação', () => {
  [[529, 5], [100, 3], [0.01, 2], [1, 7], [1234.57, 4], [999.99, 11], [50, 1], [73.33, 6]]
    .forEach(([v, n]) => assert.strictEqual(soma(dpParcelas(v, n)), v, v + '/' + n));
});

teste('parcelas inválidas devolvem lista vazia', () => {
  assert.deepStrictEqual(dpParcelas(100, 0), []);
  assert.deepStrictEqual(dpParcelas(100, -1), []);
});

// ── semanas ──
teste('semana avança de 7 em 7 e vira o mês corretamente', () => {
  assert.strictEqual(dpSemanaMais('2026-10-04', 0), '2026-10-04');
  assert.strictEqual(dpSemanaMais('2026-10-04', 1), '2026-10-11');
  assert.strictEqual(dpSemanaMais('2026-10-04', 4), '2026-11-01');
});

teste('semana atravessa o fim do ano sem erro', () => {
  assert.strictEqual(dpSemanaMais('2026-12-27', 1), '2027-01-03');
});

teste('dpIndice localiza a parcela e rejeita data fora da grade', () => {
  assert.strictEqual(dpIndice('2026-10-04', '2026-10-04'), 0);
  assert.strictEqual(dpIndice('2026-10-04', '2026-11-01'), 4);
  assert.strictEqual(dpIndice('2026-10-04', '2026-09-27'), -1);  // antes do início
  assert.strictEqual(dpIndice('2026-10-04', '2026-10-07'), -1);  // não é domingo da grade
});

// ── o plano do Leandro ──
const leandro = { _row: 2, emp: 'Leandro Venâncio', descricao: 'Conserto do carro',
  valor: 529, parcelas: 5, inicio: '2026-10-04', quitadas: [], status: 'Ativo', obs: '' };

teste('na 1ª semana: cobra $105,80 e o saldo continua cheio', () => {
  const p = dpPlano(leandro, '2026-10-04');
  assert.strictEqual(p.aDescontar, 105.8);
  assert.strictEqual(p.saldo, 529);
  assert.strictEqual(p.pago, 0);
  assert.strictEqual(p.qtdPagas, 0);
  assert.strictEqual(p.atrasadas.length, 0);
});

teste('marcar a 1ª parcela desce o saldo e não cobra de novo', () => {
  const p = dpPlano({ ...leandro, quitadas: ['2026-10-04'] }, '2026-10-04');
  assert.strictEqual(p.pago, 105.8);
  assert.strictEqual(p.saldo, 423.2);
  assert.strictEqual(p.qtdPagas, 1);
  assert.strictEqual(p.aDescontar, 0, 'parcela já marcada não pode voltar a ser cobrada');
});

teste('semana sem parcela não cobra nada', () => {
  const p = dpPlano(leandro, '2026-12-06');
  assert.strictEqual(p.aDescontar, 0);
});

// ── o ponto central: datas fixas, sem empurrar ──
teste('pular uma semana NÃO empurra as seguintes', () => {
  // ninguém descontou na semana 1; estamos na semana 2
  const p = dpPlano(leandro, '2026-10-11');
  assert.strictEqual(p.aDescontar, 105.8, 'a parcela 2 vence na data dela');
  assert.strictEqual(dpIndice(p.inicio, '2026-10-11'), 1, 'continua sendo a 2ª parcela');
  assert.strictEqual(p.atrasadas.length, 1, 'a 1ª vira atrasada');
  assert.strictEqual(p.atrasadas[0].semana, '2026-10-04');
  assert.strictEqual(p.parcelas[4].semana, '2026-11-01', 'a última não mudou de data');
});

teste('atrasadas acumulam e o saldo não fecha sozinho', () => {
  const p = dpPlano(leandro, '2026-11-01');     // última semana, nada marcado
  assert.strictEqual(p.atrasadas.length, 4);
  assert.strictEqual(p.saldo, 529);
  assert.strictEqual(p.quitado, false);
});

teste('plano todo marcado fica quitado e some da lista da semana', () => {
  const todas = ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01'];
  const p = dpPlano({ ...leandro, quitadas: todas }, '2026-11-08');
  assert.strictEqual(p.saldo, 0);
  assert.strictEqual(p.pago, 529);
  assert.strictEqual(p.quitado, true);
  assert.strictEqual(dpDaSemana([{ ...leandro, quitadas: todas }], '2026-11-08').length, 0);
});

teste('quitado continua visível na semana da última parcela', () => {
  const todas = ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01'];
  assert.strictEqual(dpDaSemana([{ ...leandro, quitadas: todas }], '2026-11-01').length, 1);
});

// ── lista da semana ──
const outro = { _row: 3, emp: 'Denys Pifane', descricao: 'Adiantamento',
  valor: 300, parcelas: 2, inicio: '2026-10-11', quitadas: [], status: 'Ativo', obs: '' };

teste('a lista ordena quem vence nesta semana primeiro', () => {
  const l = dpDaSemana([leandro, outro], '2026-10-11');
  assert.strictEqual(l.length, 2);
  assert.strictEqual(l[0].emp, 'Denys Pifane', 'maior valor da semana vem primeiro');
  assert.strictEqual(l[0].aDescontar, 150);
  assert.strictEqual(l[1].aDescontar, 105.8);
});

teste('plano que ainda não começou aparece sem cobrança', () => {
  const l = dpDaSemana([outro], '2026-10-04');
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].aDescontar, 0);
  assert.strictEqual(l[0].atrasadas.length, 0);
});

teste('soma das parcelas de um plano é sempre o valor total', () => {
  [leandro, outro, { ...leandro, valor: 1000, parcelas: 7 }].forEach(d => {
    const p = dpPlano(d, '2026-10-04');
    assert.strictEqual(soma(p.parcelas.map(x => x.valor)), d.valor, 'plano ' + d.valor + '/' + d.parcelas);
  });
});

console.log(fails ? '\n' + fails + ' falha(s).' : '\ndescontos programados ok.');
process.exit(fails ? 1 : 0);
