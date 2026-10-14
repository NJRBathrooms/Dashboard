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
  + 'crmUltimoTrabalho,crmSugestaoData,crmDuplicatas,crmMontar,crmFiltrar,'
  + 'crmAddDias,crmAddMeses,crmDefMarcos,crmMarcosObra,crmMensagem,crmPrimeiroNome,crmEndCurto,crmLinks,crmTempoIngles});')(api);
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

// ══ PARTE 2: marcos ══════════════════════════════════════
teste('soma de meses respeita o fim do mês', () => {
  assert.strictEqual(C.crmAddMeses('2026-04-17', 6), '2026-10-17');
  assert.strictEqual(C.crmAddMeses('2026-08-31', 6), '2027-02-28');
  assert.strictEqual(C.crmAddMeses('2026-10-14', 12), '2027-10-14');
  assert.strictEqual(C.crmAddDias('2026-09-20', 30), '2026-10-20');
});
teste('trilha de cliente: 30 dias, 6 meses, 1 ano… só até o próximo', () => {
  const m = C.crmDefMarcos('Cliente', '2025-04-01', '2026-10-14');
  assert.deepStrictEqual(m.map(x => x.k), ['30d', '6m', '1a', '2a']);   // 2a (01/04/2027) é o próximo
});
teste('trilha de empreiteiro não tem 30 dias', () => {
  assert.deepStrictEqual(C.crmDefMarcos('Empreiteiro', '2026-04-01', '2026-10-14').map(x => x.k), ['6m', '1a']);
});
teste('obra recém-concluída mostra só o primeiro marco, no futuro', () => {
  assert.deepStrictEqual(C.crmDefMarcos('Cliente', '2026-10-10', '2026-10-14').map(x => x.k), ['30d']);
});

const fCli = { id: 'C007', nome: 'Varsha Braham', tipo: 'Cliente', fone: '5083415700', naoContatar: false };
const fEmp = { id: 'C005', nome: 'Cris Cahil', tipo: 'Empreiteiro', fone: '6032319002', naoContatar: false };
const obraF = (conclusao, extra = {}) => ({ addr: '180 Stone School Rd', finalizada: true, conclusao, ...extra });
const estados = r => r.trilhas.map(tr => tr.dest + ':' + tr.marcos.map(m => m.k + '=' + m.estado).join(','));

teste('marco vencido sem registro fica ABERTO — não expira', () => {
  const r = C.crmMarcosObra(obraF('2025-09-01'), fCli, [], '2026-10-14');   // 13 meses
  assert.deepStrictEqual(estados(r), ['Cliente:30d=aberto,6m=aberto,1a=aberto,2a=futuro']);
  assert.strictEqual(r.abertos, 3, 'os três acumulam');
});
teste('registro fecha só aquele marco', () => {
  const r = C.crmMarcosObra(obraF('2025-09-01'), fCli, [
    { addr: '180 stone school rd', destinatario: 'Cliente', marco: '30d', resultado: 'Dispensado' },
    { addr: '180 Stone School Rd', destinatario: 'Cliente', marco: '6m', resultado: 'Enviado' },
  ], '2026-10-14');
  assert.deepStrictEqual(estados(r), ['Cliente:30d=dispensado,6m=enviado,1a=aberto,2a=futuro']);
  assert.strictEqual(r.abertos, 1);
});
teste('registro de OUTRA obra ou outro destinatário não conta', () => {
  const r = C.crmMarcosObra(obraF('2026-03-01'), fCli, [
    { addr: '99 Outra Rua', destinatario: 'Cliente', marco: '6m', resultado: 'Enviado' },
    { addr: '180 Stone School Rd', destinatario: 'Empreiteiro', marco: '6m', resultado: 'Enviado' },
  ], '2026-10-14');
  assert.ok(r.trilhas[0].marcos.find(m => m.k === '6m').estado === 'aberto');
});
teste('empreiteiro: trilha própria', () => {
  const r = C.crmMarcosObra(obraF('2026-04-01'), fEmp, [], '2026-10-14');
  assert.deepStrictEqual(estados(r), ['Empreiteiro:6m=aberto,1a=futuro']);
});
teste('autorização: marcos do empreiteiro resolvidos, morador ganha a trilha INTEIRA desde a conclusão', () => {
  const r = C.crmMarcosObra(obraF('2026-04-01', { moradorNome: 'Jane', moradorTel: '(978) 555-1234', autorizadoEm: '2026-10-14' }), fEmp, [], '2026-10-14');
  assert.deepStrictEqual(estados(r), ['Empreiteiro:6m=resolvido,1a=futuro', 'Cliente:30d=aberto,6m=aberto,1a=futuro']);
  const mor = r.trilhas[1];
  assert.strictEqual(mor.morador, true);
  assert.strictEqual(mor.fone, '9785551234');
  assert.strictEqual(mor.nome, 'Jane');
});
teste('autorização não apaga o que já foi enviado ao empreiteiro', () => {
  const r = C.crmMarcosObra(obraF('2026-04-01', { moradorNome: 'Jane', moradorTel: '9785551234', autorizadoEm: '2026-10-14' }), fEmp,
    [{ addr: '180 Stone School Rd', destinatario: 'Empreiteiro', marco: '6m', resultado: 'Enviado' }], '2026-10-14');
  assert.strictEqual(r.trilhas[0].marcos[0].estado, 'enviado');
});
teste('morador sem telefone válido não destrava nada', () => {
  const r = C.crmMarcosObra(obraF('2026-04-01', { moradorNome: 'Jane', moradorTel: '123', autorizadoEm: '2026-10-14' }), fEmp, [], '2026-10-14');
  assert.strictEqual(r.trilhas.length, 1);
});
teste('"Não contatar" suprime tudo, inclusive o morador', () => {
  const r = C.crmMarcosObra(obraF('2025-09-01', { moradorNome: 'Jane', moradorTel: '9785551234', autorizadoEm: '2026-10-14' }),
    { ...fEmp, naoContatar: true }, [], '2026-10-14');
  assert.strictEqual(r.abertos, 0);
  assert.ok(r.trilhas.every(tr => tr.marcos.every(m => m.estado !== 'aberto')));
});
teste('obra em andamento ou ficha sem tipo não tem marco', () => {
  assert.strictEqual(C.crmMarcosObra({ addr: 'x', finalizada: false, conclusao: '' }, fCli, [], '2026-10-14').trilhas.length, 0);
  assert.strictEqual(C.crmMarcosObra(obraF('2026-04-01'), { ...fCli, tipo: '' }, [], '2026-10-14').trilhas.length, 0);
});

// ── na lista ──
teste('filtro "abertos" mostra só quem tem marco aberto e conta certo', () => {
  const M2 = C.crmMontar({
    clientes: [cli('C007', 'Varsha Braham', 'Cliente', 'Nilmar', '5083415700'), cli('C010', 'Nova', 'Cliente', 'Nilmar')],
    obras: [ob('180 Stone School Rd', 'C007', '2026-04-01'), ob('1 Nova St', 'C010', '2026-10-10')],
    ultimo: {}, hoje: '2026-10-14', contatos: [],
  });
  assert.strictEqual(M2.contagem.abertos, 2);   // 30d e 6m da Varsha; a obra nova ainda não chegou aos 30 dias
  assert.deepStrictEqual(C.crmFiltrar(M2, 'abertos', '').clientes.map(f => f.id), ['C007']);
});

// ── mensagens ──
const ctx = { nome: 'Varsha', endereco: '180 Stone School Rd', morador: false, link: '' };
const todas = [['Cliente', '30d'], ['Cliente', '6m'], ['Cliente', '1a'], ['Cliente', '3a'], ['Empreiteiro', '6m'], ['Empreiteiro', '1a'], ['Empreiteiro', '2a']];
teste('toda mensagem sai preenchida, sem campo sobrando', () => {
  todas.forEach(([d, k]) => {
    const txt = C.crmMensagem(d, k, { ...ctx, empreiteiro: 'Cris', empresa: 'Cahil' });
    assert.ok(txt.length > 80, d + ' ' + k + ' veio vazia');
    assert.ok(!/[{}]|undefined|null|NaN/.test(txt), d + ' ' + k + ': ' + txt);
  });
});
teste('mensagens personalizam nome e endereço', () => {
  const t = C.crmMensagem('Cliente', '6m', ctx);
  assert.ok(t.startsWith('Hi Varsha!'));
  assert.ok(t.includes('your bathroom at 180 Stone School Rd'));
});
teste('gift card de $300 só para cliente — mencionado ao empreiteiro, nunca oferecido a ele', () => {
  assert.ok(C.crmMensagem('Cliente', '6m', ctx).includes('$300 gift card'));
  const e = C.crmMensagem('Empreiteiro', '6m', ctx);
  assert.ok(e.includes('$300 gift card when someone they refer'), 'o empreiteiro tem que saber o que vai ser oferecido');
  assert.ok(!/you('ll)? (get|receive)/i.test(e), 'ofereceu o gift card ao empreiteiro');
  ['1a', '2a'].forEach(k => assert.ok(!C.crmMensagem('Empreiteiro', k, ctx).includes('$300')));
});
teste('30 dias: sem link, o pedido de avaliação sai inteiro; com link, entra', () => {
  const sem = C.crmMensagem('Cliente', '30d', ctx);
  assert.ok(!/review/i.test(sem), 'pediu avaliação sem link');
  assert.ok(sem.includes('pH-neutral'), 'faltou a dica de cuidado');
  assert.ok(!/photo/i.test(sem), 'a linha das fotos foi tirada a pedido');
  const com = C.crmMensagem('Cliente', '30d', { ...ctx, link: 'https://g.page/r/abc/review' });
  assert.ok(com.includes('https://g.page/r/abc/review'));
});
teste('morador: diz como conseguimos o número e não repete o endereço', () => {
  const t = C.crmMensagem('Cliente', '6m', { nome: 'Jane', endereco: '74 B Averill rd', morador: true, empreiteiro: 'Cris', empresa: 'Cahil Renovations' });
  assert.ok(t.includes('Cris from Cahil Renovations gave me your number'));
  assert.strictEqual((t.match(/74 B Averill rd/g) || []).length, 1, 'endereço repetido');
  assert.ok(t.includes('since we finished it'));
});
teste('manutenção anual: 1 ano no singular, depois plural', () => {
  assert.ok(C.crmMensagem('Cliente', '1a', ctx).includes("It's been a year"));
  assert.ok(C.crmMensagem('Cliente', '3a', ctx).includes("It's been three years"));
  assert.ok(C.crmMensagem('Empreiteiro', '2a', ctx).includes('two years'));
});
// achado no ensaio com a base real: obra de 6 meses recebendo "It's been a month"
teste('mensagem enviada com atraso diz o tempo REAL, não o do marco', () => {
  const t30 = C.crmMensagem('Cliente', '30d', { ...ctx, meses: 6 });
  assert.ok(t30.includes("It's been six months since we finished"), t30.slice(0, 120));
  assert.ok(!t30.includes('a month'), 'afirmou "a month" numa obra de 6 meses');
  assert.ok(t30.includes('pH-neutral'), 'perdeu o conteúdo do marco de 30 dias');
  assert.ok(C.crmMensagem('Cliente', '6m', { ...ctx, meses: 13 }).includes("It's been a year since"));
  assert.ok(C.crmMensagem('Empreiteiro', '6m', { ...ctx, meses: 8 }).includes('eight months'));
});
teste('no prazo, o texto é o aprovado', () => {
  assert.ok(C.crmMensagem('Cliente', '30d', { ...ctx, meses: 1 }).includes("It's been a month since"));
  assert.ok(C.crmMensagem('Cliente', '6m', { ...ctx, meses: 6 }).includes("It's been six months since"));
  assert.ok(C.crmMensagem('Cliente', '1a', { ...ctx, meses: 12 }).includes("It's been a year since"));
  assert.strictEqual(C.crmTempoIngles(0), 'a month');
  assert.strictEqual(C.crmTempoIngles(25), 'two years');
});
teste('só a recorrente (2+ anos) tem a saída educada', () => {
  assert.ok(C.crmMensagem('Cliente', '2a', ctx).includes("rather I not reach out"));
  assert.ok(!C.crmMensagem('Cliente', '6m', ctx).includes("rather I not reach out"));
});
teste('primeiro nome e endereço curto', () => {
  assert.strictEqual(C.crmPrimeiroNome('paul kadilak'), 'Paul');
  assert.strictEqual(C.crmPrimeiroNome('Kate - Chris Ronche'), 'Kate');
  assert.strictEqual(C.crmPrimeiroNome(''), '');
  assert.strictEqual(C.crmEndCurto('190 Pine Street, Holbrook - MA - Fase dois'), '190 Pine Street');
  assert.strictEqual(C.crmEndCurto('174 Weirs Rd Gilford NH - tile'), '174 Weirs Rd Gilford NH');
});
teste('links: +1, texto codificado, vazio sem telefone', () => {
  const l = C.crmLinks('(603) 231-9002', "It's 6 months & counting");
  assert.ok(l.sms.startsWith('sms:+16032319002?&body='));
  assert.ok(l.wa.startsWith('https://wa.me/16032319002?text='));
  assert.ok(l.wa.includes('%26'), '& não foi codificado — cortaria a mensagem');
  assert.deepStrictEqual(C.crmLinks('', 'x'), { sms: '', wa: '' });
});

console.log(fails ? '\n' + fails + ' falha(s).' : '\ncálculo do CRM ok.');
process.exit(fails ? 1 : 0);
