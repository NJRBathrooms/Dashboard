// Roda toda a verificação antes de publicar. Um comando: npm test
//
// Camadas, da mais barata para a mais cara:
//   1. sintaxe   — node --check em cada api/*.js e no <script> de cada HTML
//   2. estrutura — balanço de <div> e ids duplicados nos HTMLs
//   3. lint      — chamadas a funções que não existem (test-lint.js)
//   4. render    — executa as telas num DOM simulado (test-render.js)
//   5. lógica    — cálculo do drywall e ações de obra (test-drywall-calc / test-completar-obra)
//
// A camada 1 sozinha NÃO basta: foi ela que deixou a aba Drywall ir quebrada ao ar
// em 28/08/2026 ($( em vez de $$( é sintaxe válida). As camadas 3 e 4 existem por isso.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const HTMLS = ['index.html', 'rentals.html', 'employees.html', 'subcontractors.html'];

let falhas = 0;
const secao = t => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length)));
const ok = t => console.log('  ok  ' + t);
const erro = (t, d) => { falhas++; console.log('  FALHOU  ' + t + (d ? '\n          ' + String(d).trim().split('\n')[0] : '')); };

// ── 1. sintaxe ─────────────────────────────────────────────
secao('sintaxe');
const tmp = path.join(raiz, '.syntax-check.tmp.js');
for (const f of fs.readdirSync(path.join(raiz, 'api')).filter(f => f.endsWith('.js'))) {
  const r = spawnSync(process.execPath, ['--check', path.join(raiz, 'api', f)], { encoding: 'utf8' });
  r.status === 0 ? ok('api/' + f) : erro('api/' + f, r.stderr);
}
for (const f of HTMLS) {
  const html = fs.readFileSync(path.join(raiz, f), 'utf8');
  const blocos = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  let bom = true;
  blocos.forEach((m, i) => {
    fs.writeFileSync(tmp, m[1]);
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    if (r.status !== 0) { bom = false; erro(f + ' (bloco ' + (i + 1) + ')', r.stderr); }
  });
  if (bom) ok(f + ' (' + blocos.length + ' bloco' + (blocos.length === 1 ? '' : 's') + ' de script)');
}
try { fs.unlinkSync(tmp); } catch (_) {}

// ── 2. estrutura do HTML ───────────────────────────────────
secao('estrutura do HTML');
for (const f of HTMLS) {
  const html = fs.readFileSync(path.join(raiz, f), 'utf8');
  const abre = (html.match(/<div\b/g) || []).length;
  const fecha = (html.match(/<\/div>/g) || []).length;
  if (abre !== fecha) erro(f + ' — <div> desbalanceada', abre + ' abertas, ' + fecha + ' fechadas');
  // ids montados em execução (concatenação ou template) repetem no fonte mas são
  // distintos na tela — só faz sentido checar duplicidade nos ids literais.
  const DINAMICO = new RegExp('[$]\\{|[+]|\'|"|`');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).filter(v => !DINAMICO.test(v));
  const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  if (dup.length) erro(f + ' — id duplicado', dup.join(', '));
  if (abre === fecha && !dup.length) ok(f + ' — ' + abre + ' divs balanceadas, ' + ids.length + ' ids únicos');
}

// ── 3-5. suítes ────────────────────────────────────────────
for (const [titulo, script] of [
  ['lint — funções inexistentes', 'test-lint.js'],
  ['render — telas num DOM simulado', 'test-render.js'],
  ['lógica — cálculo do drywall', 'test-drywall-calc.js'],
  ['lógica — cadastro/encerramento de obra', 'test-completar-obra.js'],
]) {
  secao(titulo);
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  if (r.status !== 0) { falhas++; process.stdout.write(r.stderr || ''); }
}

console.log('\n' + '═'.repeat(62));
if (falhas) { console.log('  ' + falhas + ' etapa(s) com falha — NÃO publicar.'); process.exit(1); }
console.log('  tudo verde — pode publicar.');
