// Formato dos e-mails do sistema (api/_mime.js).
//
// Origem (27/10/2026): o aviso de material ao Nilmar caiu no spam do iCloud. O
// Gmail enviava, mas a mensagem tinha remetente sem nome, só versão HTML e corpo
// sem quebra de linha garantida. Estes testes decodificam a mensagem montada e
// conferem o que o servidor de destino recebe.
//
// Rodar: node scripts/test-email-mime.js
const path = require('path');
const assert = require('assert');
const M = require(path.join(__dirname, '..', 'api', '_mime.js'));

let fails = 0;
const teste = (nome, fn) => {
  try { fn(); console.log('  ok  ' + nome); }
  catch (e) { fails++; console.log('  FALHOU  ' + nome + '\n          ' + e.message); }
};

// Separa cabeçalhos e partes, decodificando o base64 de cada uma.
function abrir(raw) {
  const [cab, ...resto] = raw.split('\r\n\r\n');
  const corpo = resto.join('\r\n\r\n');
  const h = {};
  cab.split('\r\n').forEach(l => { const i = l.indexOf(':'); h[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); });
  const b = /boundary="([^"]+)"/.exec(h['content-type'] || '');
  const dec = s => Buffer.from(s.replace(/\r\n/g, ''), 'base64').toString('utf8');
  if (!b) return { h, partes: [{ tipo: h['content-type'], txt: dec(corpo.trim()) }] };
  const partes = corpo.split('--' + b[1]).slice(1, -1).map(p => {
    const [ph, ...pc] = p.replace(/^\r\n/, '').split('\r\n\r\n');
    return { tipo: /Content-Type: ([^;\r\n]+)/.exec(ph)[1], cte: /Content-Transfer-Encoding: (\S+)/.exec(ph)[1], txt: dec(pc.join('\r\n\r\n').trim()) };
  });
  return { h, partes, fim: corpo.trim().endsWith('--' + b[1] + '--') };
}

// modelos reais, como os ramos do sistema montam
const AVISO = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px">
  <p>Olá, Nilmar.</p>
  <p>🔧 <strong>SOLICITAÇÃO DE MATERIAL PARA PRÓXIMO DIA DE TRABALHO</strong></p>
  <p>
    👤 <strong>Funcionário:</strong> Edelson de Oliveira<br>
    📍 <strong>Endereço da Obra:</strong> 365 grove st west Roxbury<br>
    📦 <strong>Materiais Solicitados:</strong> Caulking<br>2 Charcoal &amp; 1 platinum
  </p>
  <ol>
    <li>Verificar estoque para os itens solicitados</li>
    <li>Programar compra ou separação dos materiais</li>
  </ol>
  <hr style="border:none">
  <p style="font-size:12px"><em>Este e-mail foi enviado automaticamente.</em></p>
</div>`;
const CONVITE = `<p>Hello,</p><p style="margin:18px 0"><a href="https://x.app/subcontractors?k=a&amp;b=1" style="color:#000">Submit your Insurance &amp; W-9</a></p>
<p>Or copy this link:<br><a href="https://x.app/subcontractors?k=a&amp;b=1">https://x.app/subcontractors?k=a&amp;b=1</a></p>`;
// relatório de pagamento: montado na tela, numa linha só
const RELATORIO = '<table>' + Array.from({ length: 60 }, (_, i) =>
  `<tr><td style="font-weight:700">Funcionário ${i}</td><td>40h 00m</td><td>$1,000.00</td></tr>`).join('') + '</table>';

const raw = M.montarMensagem('tenilmar@icloud.com', 'Material para amanhã: Tinset — Edelson · 365 grove st', AVISO, true, { boundary: '=_njr_teste' });
const msg = abrir(raw);

teste('remetente com nome "NJR Bathrooms"', () => {
  assert.strictEqual(msg.h.from, 'NJR Bathrooms <adminnjrbathrooms@gmail.com>');
});
teste('destinatário e assunto (acento e emoji codificados)', () => {
  assert.strictEqual(msg.h.to, 'tenilmar@icloud.com');
  assert.match(msg.h.subject, /^=\?UTF-8\?B\?.+\?=$/);
  const s = Buffer.from(/\?B\?(.+)\?=/.exec(msg.h.subject)[1], 'base64').toString('utf8');
  assert.strictEqual(s, 'Material para amanhã: Tinset — Edelson · 365 grove st');
});
teste('assunto só ASCII vai sem codificar', () => {
  assert.strictEqual(abrir(M.montarMensagem('a@b.com', 'Hello', '<p>x</p>', true)).h.subject, 'Hello');
});
teste('duas versões: texto simples primeiro, HTML depois', () => {
  assert.match(msg.h['content-type'], /^multipart\/alternative;/);
  assert.deepStrictEqual(msg.partes.map(p => p.tipo), ['text/plain', 'text/html']);
  assert.ok(msg.partes.every(p => p.cte === 'base64'));
  assert.ok(msg.fim, 'faltou o fechamento do multipart');
});
teste('a versão HTML chega idêntica ao que o sistema montou', () => {
  assert.strictEqual(msg.partes[1].txt, AVISO);
});
teste('a versão texto tem o conteúdo, sem tag nenhuma', () => {
  const t = msg.partes[0].txt;
  assert.ok(!/<[a-z\/]/i.test(t), 'sobrou tag: ' + t);
  assert.ok(t.includes('Funcionário: Edelson de Oliveira'));
  assert.ok(t.includes('Endereço da Obra: 365 grove st west Roxbury'));
  assert.ok(t.includes('Materiais Solicitados: Caulking\n2 Charcoal & 1 platinum'), 'quebra de linha ou & do pedido perdido');
  assert.ok(t.includes('- Verificar estoque para os itens solicitados'));
  assert.ok(t.startsWith('Olá, Nilmar.'));
});
teste('link aparece por extenso na versão texto, sem repetir', () => {
  const t = M.htmlParaTexto(CONVITE);
  assert.ok(t.includes('Submit your Insurance & W-9 (https://x.app/subcontractors?k=a&b=1)'));
  assert.ok(t.includes('Or copy this link:\nhttps://x.app/subcontractors?k=a&b=1'));
  assert.ok(!t.includes('&amp;'));
});
teste('tabela vira linhas legíveis', () => {
  const t = M.htmlParaTexto(RELATORIO);
  assert.ok(t.includes('Funcionário 7 · 40h 00m · $1,000.00'), t.slice(0, 120));
});
teste('nenhuma linha passa do limite da norma, nem com o relatório numa linha só', () => {
  assert.ok(RELATORIO.length > 5000);
  const r = M.montarMensagem('p@hotmail.com', 'Relatório', RELATORIO, true);
  const maior = Math.max(...r.split('\r\n').map(l => l.length));
  assert.ok(maior <= 998, 'linha de ' + maior + ' caracteres');
  assert.strictEqual(abrir(r).partes[1].txt, RELATORIO, 'o relatório chegou diferente');
});
teste('e-mail de texto puro continua funcionando', () => {
  const r = abrir(M.montarMensagem('a@b.com', 'Oi', 'linha 1\nlinha 2 — ok', false));
  assert.strictEqual(r.h['content-type'], 'text/plain; charset="UTF-8"');
  assert.strictEqual(r.partes[0].txt, 'linha 1\nlinha 2 — ok');
});
teste('o separador nunca aparece dentro do conteúdo', () => {
  const r = M.montarMensagem('a@b.com', 'x', AVISO + RELATORIO, true);
  const b = /boundary="([^"]+)"/.exec(r)[1];
  assert.strictEqual(r.split('--' + b).length - 1, 3, 'separador repetido no corpo');
});
teste('GMAIL_FROM troca o endereço, mantendo o nome', () => {
  process.env.GMAIL_FROM = 'outra@exemplo.com';
  const h = abrir(M.montarMensagem('a@b.com', 'x', '<p>y</p>', true)).h;
  delete process.env.GMAIL_FROM;
  assert.strictEqual(h.from, 'NJR Bathrooms <outra@exemplo.com>');
});

console.log(fails ? '\n' + fails + ' falha(s).' : '\nformato dos e-mails ok.');
process.exit(fails ? 1 : 0);
