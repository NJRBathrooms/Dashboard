// Aviso de material para amanhã (addLabor → e-mail ao Nilmar).
//
// Origem (27/10/2026): o Edelson pediu "Tinset" em 26/10, o registro foi
// gravado, mas o aviso não apareceu para o Nilmar. O envio funcionava, porém
// qualquer falha era engolida sem rastro — não havia como saber se o e-mail
// tinha saído. E todo aviso tinha o mesmo assunto, então o iPhone juntava todos
// numa conversa só.
//
// Estes testes travam: o resultado do envio fica na linha ("Status do Aviso"),
// há uma segunda tentativa, o lançamento nunca cai por causa do aviso, e cada
// aviso tem assunto próprio.
//
// Rodar: node scripts/test-aviso-material.js
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const H_LAB = ['Carimbo de data/hora', 'Endereço da obra', 'Nome do funcionário', 'Hora de entrada', 'Hora de saída',
  'Comprou materiais hoje?', 'Valor total gasto', 'Quem pagou?', 'Foto do recibo (se aplicável)',
  'Algum material é necessário para amanhã?', 'Observações / Sugestões (Opcional, para feedback espontâneo)',
  'Endereço de email', 'Horas tabalhadas'];
const H_OBR = ['Endereço', 'Nome do Cliente', 'Orçamento', 'Finalizada'];

let LAB, enviados, falhasPendentes, statusFalha, escritasStatus;
function reset() {
  LAB = [H_LAB.slice()];
  enviados = []; falhasPendentes = 0; statusFalha = false; escritasStatus = [];
}
reset();

const gp = path.join(ROOT, 'api', '_google.js');
require.cache[require.resolve(gp)] = { id: gp, filename: gp, loaded: true, exports: {
  normStr: s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' '),
  loadSheetIndex: async () => ({ tz: 'America/New_York', index: [
    { title: 'Registro', sheetId: 1, headers: LAB[0].filter(Boolean) },
    { title: 'Obras', sheetId: 2, headers: H_OBR },
  ] }),
  findSheetEntry: (index, kws) => index.find(s => kws.every(k => s.headers.some(h => h.toLowerCase().includes(k)))) || null,
  readColumn: async (title, i) => (title === 'Obras' ? [H_OBR, ['365 grove st west Roxbury', 'Bob', 23600, 'Não']] : LAB).map(r => r[i]),
  buildRow: (headers, mapping) => {
    const row = new Array(headers.length).fill('');
    for (const m of mapping) {
      if (m.val === undefined) continue;
      const i = m.fuzzy ? headers.findIndex(h => h.toLowerCase().includes(m.key.toLowerCase())) : headers.indexOf(m.key);
      if (i >= 0) row[i] = m.val;
    }
    return row;
  },
  appendRow: async (t, row) => { LAB.push(row.slice()); return LAB.length; },
  updateCell: async (t, rowNum, col, val) => { while (LAB[0].length <= col) LAB[0].push(''); LAB[0][col] = val; },
  updateRowCells: async (t, rowNum, headers, ups) => {
    if (statusFalha) throw new Error('quota da planilha');
    ups.forEach(u => {
      const i = headers.indexOf(u.key);
      const r = LAB[rowNum - 1]; while (r.length <= i) r.push('');
      r[i] = u.val; escritasStatus.push({ rowNum, key: u.key, val: u.val });
    });
  },
  sendEmail: async (to, subject, html) => {
    if (falhasPendentes > 0) { falhasPendentes--; throw new Error('Gmail 503 backendError'); }
    enviados.push({ to, subject, html });
  },
  nowInTz: () => '2026/10/26 19:39:37',
  nowFriendly: () => '26/10/2026 19:39',
  appendRows: async () => {}, batchUpdateRows: async () => 0, createSheet: async () => {}, deleteRow: async () => {},
} };

// o console.error de falha é esperado em alguns testes — silencia para a saída ficar legível
const errOrig = console.error; let errosLog = [];
console.error = (...a) => { errosLog.push(a.join(' ')); };

const A = require(path.join(ROOT, 'api', '_actions.js'));

let fails = 0;
const teste = async (nome, fn) => {
  try { await fn(); console.log('  ok  ' + nome); }
  catch (e) { fails++; console.log('  FALHOU  ' + nome + '\n          ' + e.message); }
};
const lancar = extra => A.addLabor({ emp: 'Edelson de Oliveira', addr: '365 grove st west Roxbury',
  entryTime: '08:40', exitTime: '18:20', ...extra });
const col = nome => LAB[0].indexOf(nome);
const ultima = () => LAB[LAB.length - 1];

(async () => {
  await teste('sem material pedido: nenhum e-mail, nenhuma coluna nova', async () => {
    reset();
    const r = await lancar({ materialNeeded: '' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(col('Status do Aviso'), -1, 'criou a coluna sem precisar');
  });

  await teste('o caso do Edelson: e-mail sai e o envio fica registrado na linha', async () => {
    reset();
    const r = await lancar({ materialNeeded: 'Tinset' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].to, 'tenilmar@icloud.com');
    assert.strictEqual(ultima()[col('Algum material é necessário para amanhã?')], 'Tinset');
    assert.strictEqual(ultima()[col('Status do Aviso')], 'enviado 26/10/2026 19:39 → tenilmar@icloud.com');
  });

  await teste('assunto único: material, quem pediu e a obra', async () => {
    assert.strictEqual(enviados[0].subject, 'Material para amanhã: Tinset — Edelson · 365 grove st west Roxbury');
  });

  await teste('dois pedidos diferentes não têm o mesmo assunto (o iPhone não junta)', async () => {
    reset();
    await lancar({ materialNeeded: 'Tinset' });
    await A.addLabor({ emp: 'Denys Pifane', addr: '45 Earle Rd. Wellesley', materialNeeded: 'Clips e cunhas' });
    assert.notStrictEqual(enviados[0].subject, enviados[1].subject);
  });

  await teste('falha passageira: a 2ª tentativa envia e isso fica anotado', async () => {
    reset(); falhasPendentes = 1;
    await lancar({ materialNeeded: 'Tinset' });
    assert.strictEqual(enviados.length, 1);
    assert.match(ultima()[col('Status do Aviso')], /^enviado .*\(2ª tentativa\)$/);
  });

  await teste('falha nas duas tentativas: o lançamento é salvo e a FALHA fica visível na linha', async () => {
    reset(); falhasPendentes = 2; errosLog = [];
    const r = await lancar({ materialNeeded: 'Tinset' });
    assert.strictEqual(r.ok, true, 'o funcionário recebeu erro por causa do e-mail');
    assert.strictEqual(LAB.length, 2, 'o registro de horas não foi gravado');
    assert.strictEqual(ultima()[col('Status do Aviso')], 'FALHOU 26/10/2026 19:39: Gmail 503 backendError');
    assert.ok(errosLog.some(l => /Gmail 503/.test(l)), 'a falha não foi para o log');
  });

  await teste('se nem o status conseguir ser gravado, o lançamento continua ok', async () => {
    reset(); statusFalha = true;
    const r = await lancar({ materialNeeded: 'Tinset' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(enviados.length, 1, 'o e-mail tem que sair mesmo assim');
  });

  await teste('a coluna nova não rouba a gravação do material (busca por trecho "material")', async () => {
    reset();
    await lancar({ materialNeeded: 'Primeiro' });
    await lancar({ materialNeeded: 'Segundo' });        // agora a coluna "Status do Aviso" já existe
    assert.strictEqual(ultima()[col('Algum material é necessário para amanhã?')], 'Segundo');
    assert.ok(/^enviado/.test(ultima()[col('Status do Aviso')]));
    assert.strictEqual(LAB[0].filter(h => h === 'Status do Aviso').length, 1, 'cabeçalho duplicado');
  });

  await teste('pedido de várias linhas: assunto usa a primeira; o corpo leva todas', async () => {
    reset();
    await lancar({ materialNeeded: 'Caulking\n2 Charcoal\n1 platinum' });
    assert.strictEqual(enviados[0].subject, 'Material para amanhã: Caulking — Edelson · 365 grove st west Roxbury');
    assert.ok(enviados[0].html.includes('Caulking<br>2 Charcoal<br>1 platinum'));
  });

  await teste('pedido longo é encurtado no assunto', async () => {
    reset();
    await lancar({ materialNeeded: 'Vai precisar de massa e espaçador de 1/16 e clip 1/8 e cunhas extras' });
    const s = enviados[0].subject.split(' — ')[0].replace('Material para amanhã: ', '');
    assert.ok(s.length <= 48 && s.endsWith('…'), 'assunto não encurtou: ' + s);
  });

  await teste('o texto do funcionário vai escapado no e-mail', async () => {
    reset();
    await lancar({ materialNeeded: '<b>massa</b> & clips' });
    assert.ok(enviados[0].html.includes('&lt;b&gt;massa&lt;/b&gt; &amp; clips'));
  });

  await teste('NOTIFY_EMAIL continua valendo', async () => {
    reset(); process.env.NOTIFY_EMAIL = 'outro@exemplo.com';
    await lancar({ materialNeeded: 'Tinset' });
    delete process.env.NOTIFY_EMAIL;
    assert.strictEqual(enviados[0].to, 'outro@exemplo.com');
    assert.ok(ultima()[col('Status do Aviso')].endsWith('→ outro@exemplo.com'));
  });

  console.error = errOrig;
  console.log(fails ? '\n' + fails + ' falha(s).' : '\naviso de material ok.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error = errOrig; console.log('  FALHOU  exceção não tratada: ' + e.stack); process.exit(1); });
