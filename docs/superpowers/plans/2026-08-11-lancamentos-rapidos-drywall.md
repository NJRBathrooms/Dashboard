# Lançamentos Rápidos — Drywall — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao app admin da NJR um controle paralelo e leve para serviços de drywall, onde equipes de terceiros são pagas por diária e a mesma diária é rateada entre os endereços atendidos no dia.

**Architecture:** Uma única aba `Drywall` na planilha Google (desnormalizada, uma linha por lançamento). Todo o cálculo — rateio da diária, receita por serviço, lucro — é derivado na leitura por um bloco de funções puras dentro do `index.html`, testado por um script node que extrai esse bloco do próprio arquivo publicado. Nenhuma função serverless nova: as ações entram no `api/write.js` já existente.

**Tech Stack:** HTML/JS vanilla (sem build, sem framework), Node 18+ serverless na Vercel, `googleapis` para Sheets. Sem framework de teste — a validação é `node --check`, contagem de divs e um script de asserções em node puro.

## Global Constraints

- **Limite de 12 funções serverless (Vercel Hobby).** O projeto está em 12/12. Nenhum arquivo novo em `api/` sem underscore. Arquivos `api/_*.js` são helpers e não contam.
- **App em português.** Toda a UI, mensagens de erro e rótulos em pt-BR.
- **Nomes exatos das colunas da aba `Drywall`:** `Carimbo de data/hora`, `Data`, `Cliente`, `Endereço`, `Valor Cobrado ($)`, `Pessoa`, `Companhia`, `Diária ($)`, `Observações`.
- **Nome da aba na planilha:** `Drywall`. **Nome da seção na UI:** `Lançamentos Rápidos — Drywall`. **Rótulo do botão da aba:** `Drywall`.
- **Sub-abas em Controle de Obras:** `Obras Bathroom/Tile` e `Obras Drywall`.
- **Chaves de agrupamento normalizadas** (trim + lowercase + espaços colapsados): `Endereço` identifica o serviço, `Pessoa + Data` identifica o grupo de rateio.
- **Receita gravada uma única vez por endereço.** Na leitura, receita = primeiro `Valor Cobrado ($)` não-vazio daquele endereço, ordenado por linha.
- **Diária é snapshot** — gravada em cada lançamento, nunca buscada de cadastro.
- **Nenhuma alteração** em `calcAddr`, gráficos, invoice, Registros, Fechar/Consultar ou `employees.html`.
- **Push:** repositório `NJRBathrooms/Dashboard` branch `main`, via GitHub Trees API (commit único), token lido de `C:\Users\Felip\.njr-github-token`. Não é repo git local — `git commit` não se aplica; "commit" nas tarefas significa gravar o arquivo e validar, com o push agrupado na Task 6.

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `api/_actions.js` | Aba `Drywall`: criação, insert, update, delete | Modificar |
| `api/write.js` | Registrar as 3 ações novas no dispatcher | Modificar |
| `api/_google.js` | `readAll` devolver `drywall` normalizado | Modificar |
| `index.html` | Guarda de duplo toque, bloco puro de cálculo, aba 8, sub-abas da aba 1 | Modificar |
| `scripts/test-drywall-calc.js` | Asserções sobre o bloco puro extraído do `index.html` | Criar |

---

### Task 1: Proteção contra duplo toque no app admin

Porta do `rentals.html` a guarda que impede que um segundo toque grave o mesmo lançamento duas vezes. Feita primeiro porque a tela de lançamento rápido (Task 4) depende dela: ali um duplicado não só cria uma linha extra, ele altera o rateio de todas as outras linhas do dia.

**Files:**
- Modify: `index.html` (função `apiWrite`, por volta da linha 944)

**Interfaces:**
- Consumes: nada
- Produces: `apiWrite(params)` com dedup de requisições idênticas em voo; `runBtn(btn, fn, labelHTML?)` → `Promise<any>`, trava o botão e restaura o HTML original ao final

- [ ] **Step 1: Substituir `apiWrite` e adicionar `runBtn`**

Localize em `index.html`:

```js
async function apiWrite(params) {
  const res = await fetch('/api/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (res.status === 401) { doLogout(); throw new Error('Sessão expirada. Faça login novamente.'); }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
```

Substitua por:

```js
// Requisições de escrita em voo — evita que um 2º toque no botão (enquanto a 1ª
// chamada ainda não voltou) grave o mesmo lançamento duas vezes na planilha.
const _inFlight = new Map();
async function apiWrite(params) {
  const body = JSON.stringify(params);
  if (_inFlight.has(body)) return _inFlight.get(body); // mesma gravação já em curso
  const p = (async () => {
    const res = await fetch('/api/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (res.status === 401) { doLogout(); throw new Error('Sessão expirada. Faça login novamente.'); }
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  })();
  _inFlight.set(body, p);
  try { return await p; }
  finally { _inFlight.delete(body); }
}
// Executa uma ação de gravação travando o botão (evita duplo toque e dá feedback)
async function runBtn(btn, fn, labelHTML) {
  if (!btn) return fn();
  if (btn.disabled) return;
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;margin-right:6px"></div>' + (labelHTML || 'Salvando...');
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = orig; }
}
```

- [ ] **Step 2: Validar sintaxe e balanceamento**

Run:
```bash
cd "c:\Users\Felip\OneDrive\Área de Trabalho\AI\PASTA VS CODER"
node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');
fs.writeFileSync('_chk.js',js);
const o=(html.match(/<div\b/g)||[]).length,c=(html.match(/<\/div>/g)||[]).length;
console.log('divs open=%d close=%d',o,c);
"
node --check _chk.js && echo "JS OK" ; rm -f _chk.js
```
Expected: `divs open=442 close=442` (iguais) e `JS OK`.

- [ ] **Step 3: Confirmar que a guarda existe uma única vez**

Run: `grep -c "_inFlight" index.html`
Expected: `4` (declaração + has + set + delete).

---

### Task 2: Backend — aba `Drywall`, ações de escrita e leitura

**Files:**
- Modify: `api/_actions.js` (bloco novo antes de `// ── INSURANCE & W9`, e exports no final)
- Modify: `api/write.js` (HANDLERS)
- Modify: `api/_google.js` (`readAll`)

**Interfaces:**
- Consumes: `G.loadSheetIndex`, `G.createSheet`, `G.buildRow`, `G.appendRow`, `G.readColumn`, `G.updateRowCells`, `G.deleteRow`, `G.normStr`, `G.nowInTz`, `round2` (todos já existem)
- Produces:
  - `addDrywall({data, cliente, addr, valorCobrado, pessoa, companhia, diaria, obs})` → `{ok:true}` | `{error:string}`
  - `updateDrywall({rowNum, cliente?, addr?, valorCobrado?, pessoa?, companhia?, diaria?, data?, obs?})` → `{ok:true}` | `{error:string}`
  - `deleteDrywall({rowNum})` → `{ok:true}` | `{error:string}`
  - `readAll()` passa a devolver `drywall: Array<{_row, ts, data, cliente, addr, valorCobrado, pessoa, companhia, diaria, obs}>` onde `data` é `'YYYY-MM-DD'` e `valorCobrado` é `string` (`''` quando vazio)

- [ ] **Step 1: Adicionar o bloco Drywall em `api/_actions.js`**

Insira imediatamente **antes** da linha `// ── INSURANCE & W9 (compliance de subcontratados) ──────────`:

```js
// ── DRYWALL (lançamentos rápidos) ──────────────────────────
// Aba única e desnormalizada: cada linha = 1 lançamento (pessoa + dia + serviço).
// O "Valor Cobrado" é gravado só na 1ª linha de cada endereço — ver addDrywall.
const DRYWALL_SHEET = 'Drywall';
const DRYWALL_HEADERS = ['Carimbo de data/hora', 'Data', 'Cliente', 'Endereço', 'Valor Cobrado ($)', 'Pessoa', 'Companhia', 'Diária ($)', 'Observações'];

async function ensureDrywallSheet() {
  let { index } = await G.loadSheetIndex();
  let sh = index.find(s => s.title === DRYWALL_SHEET);
  if (!sh) {
    await G.createSheet(DRYWALL_SHEET, DRYWALL_HEADERS);
    ({ index } = await G.loadSheetIndex());
    sh = index.find(s => s.title === DRYWALL_SHEET);
  }
  return sh;
}

// true se o endereço já tem um "Valor Cobrado" preenchido em alguma linha
async function drywallJaTemReceita(sh, addr) {
  const addrIdx = sh.headers.indexOf('Endereço');
  const valIdx = sh.headers.indexOf('Valor Cobrado ($)');
  if (addrIdx < 0 || valIdx < 0) return false;
  const addrCol = await G.readColumn(sh.title, addrIdx);
  const valCol = await G.readColumn(sh.title, valIdx);
  for (let i = 1; i < addrCol.length; i++) {
    if (G.normStr(addrCol[i]) === G.normStr(addr) && String(valCol[i] == null ? '' : valCol[i]).trim() !== '') return true;
  }
  return false;
}

async function addDrywall(params) {
  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };
  const data = String(params.data || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { error: 'Data inválida (use AAAA-MM-DD).' };
  const pessoa = (params.pessoa || '').trim();
  const temDiaria = params.diaria !== undefined && params.diaria !== null && params.diaria !== '';
  const diaria = temDiaria ? round2(params.diaria) : 0;
  if (pessoa && !(diaria > 0)) return { error: 'Informe a diária da pessoa.' };
  if (!pessoa && temDiaria) return { error: 'Informe a pessoa para lançar uma diária.' };

  const sh = await ensureDrywallSheet();
  if (!sh) return { error: 'Não foi possível criar a aba "Drywall".' };

  // Receita grava só uma vez por endereço — se já existe, ignora o valor recebido.
  let valorFinal = '';
  const temValor = params.valorCobrado !== undefined && params.valorCobrado !== null && String(params.valorCobrado).trim() !== '';
  if (temValor && !(await drywallJaTemReceita(sh, addr))) valorFinal = round2(params.valorCobrado);

  const row = G.buildRow(sh.headers, [
    { key: 'Carimbo de data/hora', val: G.nowInTz() },
    { key: 'Data', val: data, forceText: true },
    { key: 'Cliente', val: (params.cliente || '').trim() },
    { key: 'Endereço', val: addr },
    { key: 'Valor Cobrado ($)', val: valorFinal },
    { key: 'Pessoa', val: pessoa },
    { key: 'Companhia', val: (params.companhia || '').trim() },
    { key: 'Diária ($)', val: pessoa ? diaria : '' },
    { key: 'Observações', val: (params.obs || '').trim() },
  ]);
  await G.appendRow(sh.title, row);
  return { ok: true };
}

async function updateDrywall(params) {
  const sh = await ensureDrywallSheet();
  if (!sh) return { error: 'Aba "Drywall" não encontrada.' };
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Linha inválida.' };

  const updates = [];
  if (params.data !== undefined) {
    const d = String(params.data || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: 'Data inválida (use AAAA-MM-DD).' };
    updates.push({ key: 'Data', val: d, forceText: true });
  }
  if (params.cliente !== undefined) updates.push({ key: 'Cliente', val: String(params.cliente || '').trim() });
  if (params.addr !== undefined) {
    const a = String(params.addr || '').trim();
    if (!a) return { error: 'Endereço não pode ficar vazio.' };
    updates.push({ key: 'Endereço', val: a });
  }
  if (params.valorCobrado !== undefined) {
    const v = String(params.valorCobrado).trim();
    updates.push({ key: 'Valor Cobrado ($)', val: v === '' ? '' : round2(v) });
  }
  if (params.pessoa !== undefined) updates.push({ key: 'Pessoa', val: String(params.pessoa || '').trim() });
  if (params.companhia !== undefined) updates.push({ key: 'Companhia', val: String(params.companhia || '').trim() });
  if (params.diaria !== undefined) {
    const v = String(params.diaria).trim();
    updates.push({ key: 'Diária ($)', val: v === '' ? '' : round2(v) });
  }
  if (params.obs !== undefined) updates.push({ key: 'Observações', val: String(params.obs || '').trim() });
  if (!updates.length) return { error: 'Nada para atualizar.' };

  await G.updateRowCells(sh.title, rowNum, sh.headers, updates);
  return { ok: true };
}

async function deleteDrywall(params) {
  const sh = await ensureDrywallSheet();
  if (!sh) return { error: 'Aba "Drywall" não encontrada.' };
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Linha inválida.' };
  await G.deleteRow(sh.sheetId, rowNum);
  return { ok: true };
}

```

- [ ] **Step 2: Exportar as ações**

Em `api/_actions.js`, localize:

```js
  addRateChange, deleteRateChange,
```

Substitua por:

```js
  addRateChange, deleteRateChange,
  addDrywall, updateDrywall, deleteDrywall,
```

- [ ] **Step 3: Registrar no dispatcher**

Em `api/write.js`, localize:

```js
  addRateChange: A.addRateChange,
  deleteRateChange: A.deleteRateChange,
```

Substitua por:

```js
  addRateChange: A.addRateChange,
  deleteRateChange: A.deleteRateChange,
  addDrywall: A.addDrywall,
  updateDrywall: A.updateDrywall,
  deleteDrywall: A.deleteDrywall,
```

- [ ] **Step 4: Expor `drywall` no `readAll`**

Em `api/_google.js`, localize dentro de `readAll`:

```js
  const rateh = findValues(byTitle, ['nome', 'vigente desde']);
  return {
```

Substitua por:

```js
  const rateh = findValues(byTitle, ['nome', 'vigente desde']);
  const dryw = findValues(byTitle, ['pessoa', 'diária']);
  return {
    // Drywall: 1 linha = 1 lançamento. O rateio da diária é calculado no cliente.
    drywall:        dryw  ? rowsToObjects(dryw).map(r => ({
      _row: r._row,
      ts: r['Carimbo de data/hora'] || '',
      // aceita texto 'YYYY-MM-DD' e também data convertida pelo Sheets ('YYYY/MM/DD HH:mm:ss')
      data: String(r['Data'] || '').trim().slice(0, 10).replace(/\//g, '-'),
      cliente: String(r['Cliente'] || '').trim(),
      addr: String(r['Endereço'] || '').trim(),
      valorCobrado: String(r['Valor Cobrado ($)'] == null ? '' : r['Valor Cobrado ($)']).trim(),
      pessoa: String(r['Pessoa'] || '').trim(),
      companhia: String(r['Companhia'] || '').trim(),
      diaria: Number(r['Diária ($)']) || 0,
      obs: String(r['Observações'] || '').trim(),
    })).filter(r => r.addr) : [],
```

- [ ] **Step 5: Validar sintaxe dos três arquivos**

Run:
```bash
cd "c:\Users\Felip\OneDrive\Área de Trabalho\AI\PASTA VS CODER"
for f in api/_actions.js api/write.js api/_google.js; do node --check "$f" && echo "OK: $f"; done
```
Expected: `OK:` para os três.

- [ ] **Step 6: Confirmar que o limite de funções serverless não foi violado**

Run:
```bash
cd "c:\Users\Felip\OneDrive\Área de Trabalho\AI\PASTA VS CODER/api"
ls *.js | grep -v '^_' | wc -l
```
Expected: `12`.

---

### Task 3: Bloco puro de cálculo + testes

O núcleo de risco da feature. Escrito com teste primeiro, porque o rateio em centavos e a regra de "receita não soma" são exatamente onde erros silenciosos aparecem.

**Files:**
- Create: `scripts/test-drywall-calc.js`
- Modify: `index.html` (bloco novo logo antes de `function processAll()`)

**Interfaces:**
- Consumes: nada (bloco puro, sem DOM)
- Produces (usado pelas Tasks 4 e 5):
  - `dwNorm(s)` → `string`
  - `dwRound2(n)` → `number`
  - `dwLancamentos(raw)` → `Array<{_row, data, pessoa, companhia, addr, diaria, divisor, custo}>`
  - `dwServicos(raw)` → `Array<{addr, cliente, receita, custo, lucro, inicio, lancamentos}>`
  - `dwPessoas(raw)` → `Array<{nome, companhia, diaria}>`
  - `dwServicosDoMes(raw, ym)` → mesmo shape de `dwServicos`, filtrado por `ym` (`'YYYY-MM'`)
  - `dwTotais(servicos)` → `{receita, custo, lucro, margem}`

- [ ] **Step 1: Escrever o teste que falha**

Create `scripts/test-drywall-calc.js`:

```js
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
new Function('__out', m[0] + '\nObject.assign(__out,{dwNorm,dwRound2,dwLancamentos,dwServicos,dwPessoas,dwServicosDoMes,dwTotais});')(api);
const { dwLancamentos, dwServicos, dwPessoas, dwServicosDoMes, dwTotais } = api;

let n = 0;
const t = (nome, fn) => { fn(); n++; console.log('  ok  ' + nome); };

// Fixture: Carlos ($200/dia) em 3 endereços no dia 12; 1 endereço no dia 13.
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

t('receita não soma quando o serviço tem várias diárias', () => {
  const s = dwServicos(base).find(x => x.addr === '8 Elm Rd');
  assert.strictEqual(s.receita, 950, 'receita deve continuar 950, não 1900');
  assert.strictEqual(s.custo, dwTotais([s]).custo);
  assert.strictEqual(s.custo, Math.round((66.67 + 200) * 100) / 100);
  assert.strictEqual(s.lucro, Math.round((950 - s.custo) * 100) / 100);
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
  assert.strictEqual(servicos.filter(s => dwNormAddrEq(s.addr, '12 Oak St')).length, 1, 'não pode duplicar o serviço');
  const s = servicos.find(x => dwNormAddrEq(x.addr, '12 Oak St'));
  assert.strictEqual(s.receita, 800, 'receita continua a do 1º lançamento');
  assert.strictEqual(s.custo, Math.round((66.67 + 180) * 100) / 100);
});
function dwNormAddrEq(a, b) { return String(a).trim().toLowerCase().replace(/\s+/g, ' ') === String(b).trim().toLowerCase().replace(/\s+/g, ' '); }

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
  assert.strictEqual(s.custo, Math.round((66.67 + 200 + 180) * 100) / 100);
  assert.strictEqual(dwServicosDoMes(raw, '2026-09').some(x => x.addr === '8 Elm Rd'), false);
});

console.log('\n' + n + ' testes passaram.');
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node scripts/test-drywall-calc.js`
Expected: FALHA com `FALHOU: bloco "DRYWALL — CÁLCULO" não encontrado no index.html` e exit code 1.

- [ ] **Step 3: Implementar o bloco puro**

Em `index.html`, insira imediatamente **antes** da linha `function processAll() {`:

```js
// ══ DRYWALL — CÁLCULO (bloco puro, sem DOM; testado por scripts/test-drywall-calc.js) ══
function dwNorm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
function dwRound2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Lançamentos com o custo rateado: a diária de uma pessoa num dia é dividida
// entre os lançamentos dela naquele dia. O resto em centavos é distribuído nos
// primeiros, para a soma bater exatamente com a diária.
function dwLancamentos(raw) {
  const rows = (raw || []).filter(r => r && dwNorm(r.addr) && dwNorm(r.pessoa));
  const grupos = {};
  rows.forEach(r => { const k = dwNorm(r.pessoa) + '|' + String(r.data || ''); (grupos[k] = grupos[k] || []).push(r); });
  const out = [];
  Object.keys(grupos).forEach(k => {
    const g = grupos[k].slice().sort((a, b) => (a._row || 0) - (b._row || 0));
    const diaria = Number(g[0].diaria) || 0;      // snapshot: a diária do dia
    const cents = Math.round(diaria * 100);
    const per = Math.floor(cents / g.length);
    const resto = cents - per * g.length;
    g.forEach((r, i) => out.push({
      _row: r._row, data: r.data, pessoa: r.pessoa, companhia: r.companhia || '',
      addr: r.addr, diaria, divisor: g.length,
      custo: (per + (i < resto ? 1 : 0)) / 100,
    }));
  });
  return out.sort((a, b) => String(a.data || '').localeCompare(String(b.data || ''))
    || dwNorm(a.pessoa).localeCompare(dwNorm(b.pessoa))
    || (a._row || 0) - (b._row || 0));
}

// Um serviço por endereço: receita (nunca somada), custo rateado e lucro.
function dwServicos(raw) {
  const rows = (raw || []).filter(r => r && dwNorm(r.addr)).slice().sort((a, b) => (a._row || 0) - (b._row || 0));
  const byAddr = {};
  rows.forEach(r => {
    const k = dwNorm(r.addr);
    if (!byAddr[k]) byAddr[k] = { addr: r.addr, cliente: '', receita: 0, _receitaSet: false, custo: 0, inicio: '', lancamentos: [] };
    const s = byAddr[k];
    if (!s.cliente && r.cliente) s.cliente = r.cliente;
    // receita = primeiro "Valor Cobrado" não-vazio do endereço
    if (!s._receitaSet && String(r.valorCobrado == null ? '' : r.valorCobrado).trim() !== '') {
      s.receita = Number(r.valorCobrado) || 0; s._receitaSet = true;
    }
    if (r.data && (!s.inicio || String(r.data) < s.inicio)) s.inicio = String(r.data);
  });
  dwLancamentos(raw).forEach(l => {
    const s = byAddr[dwNorm(l.addr)];
    if (s) { s.custo = dwRound2(s.custo + l.custo); s.lancamentos.push(l); }
  });
  return Object.keys(byAddr).map(k => {
    const s = byAddr[k];
    return { addr: s.addr, cliente: s.cliente, receita: s.receita, custo: s.custo, lucro: dwRound2(s.receita - s.custo), inicio: s.inicio, lancamentos: s.lancamentos };
  });
}

// Pessoas conhecidas (dropdown), com a companhia e a diária do lançamento mais recente
function dwPessoas(raw) {
  const by = {};
  (raw || []).filter(r => r && dwNorm(r.pessoa)).slice().sort((a, b) => (a._row || 0) - (b._row || 0))
    .forEach(r => { by[dwNorm(r.pessoa)] = { nome: r.pessoa, companhia: r.companhia || '', diaria: Number(r.diaria) || 0 }; });
  return Object.keys(by).map(k => by[k]).sort((a, b) => a.nome.localeCompare(b.nome));
}

// Serviços do mês (pelo mês do 1º lançamento), com receita e custo integrais
function dwServicosDoMes(raw, ym) {
  return dwServicos(raw).filter(s => String(s.inicio || '').slice(0, 7) === ym)
    .sort((a, b) => String(a.inicio || '').localeCompare(String(b.inicio || '')) || a.addr.localeCompare(b.addr));
}

function dwTotais(servicos) {
  const receita = dwRound2((servicos || []).reduce((s, x) => s + (x.receita || 0), 0));
  const custo = dwRound2((servicos || []).reduce((s, x) => s + (x.custo || 0), 0));
  const lucro = dwRound2(receita - custo);
  return { receita, custo, lucro, margem: receita > 0 ? dwRound2(lucro / receita * 100) : 0 };
}
// ══ FIM DRYWALL — CÁLCULO ══
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node scripts/test-drywall-calc.js`
Expected: 10 linhas `ok` e `10 testes passaram.`, exit code 0.

- [ ] **Step 5: Validar sintaxe e balanceamento do `index.html`**

Run:
```bash
cd "c:\Users\Felip\OneDrive\Área de Trabalho\AI\PASTA VS CODER"
node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');
fs.writeFileSync('_chk.js',js);
const o=(html.match(/<div\b/g)||[]).length,c=(html.match(/<\/div>/g)||[]).length;
console.log('divs open=%d close=%d',o,c);
"
node --check _chk.js && echo "JS OK" ; rm -f _chk.js
```
Expected: divs iguais e `JS OK`.

---

### Task 4: Aba `Drywall` — lançamento rápido

**Files:**
- Modify: `index.html` (botão da aba, página `t8page`, `activateTab`, limite de swipe, `renderAll`, funções de render e ações)

**Interfaces:**
- Consumes: `dwPessoas`, `dwServicos`, `dwLancamentos`, `dwRound2`, `dwNorm` (Task 3); `apiWrite`, `runBtn` (Task 1); `addDrywall`, `deleteDrywall` (Task 2); helpers existentes `$$`, `escH`, `esc`, `showToast`, `loadData`, `fmtDay`
- Produces: `renderDrywall()` — chamada por `renderAll()`; `PROC.drywall` — array cru usado pela Task 5

- [ ] **Step 1: Adicionar o botão da aba**

Localize:

```html
    <button class="tab-btn" id="t7btn" onclick="showTab(7)"><i class="fas fa-users-gear"></i> Usuários</button>
```

Substitua por:

```html
    <button class="tab-btn" id="t7btn" onclick="showTab(7)"><i class="fas fa-users-gear"></i> Usuários</button>
    <button class="tab-btn" id="t8btn" onclick="showTab(8)"><i class="fas fa-trowel-bricks"></i> Drywall</button>
```

- [ ] **Step 2: Adicionar a página da aba**

Localize o início da página 7 e o fim dela. Insira **depois** do `</div>` que fecha `t7page` (imediatamente antes do comentário `<!-- INVOICE (consulta) -->`):

```html
  <!-- TAB 8 — DRYWALL -->
  <div id="t8page" class="page" style="display:none">
    <div id="t8body"><div class="loading-box"><div class="spinner"></div>Carregando dados...</div></div>
  </div>
```

- [ ] **Step 3: Ajustar os limites de navegação**

Localize:

```js
  [1,2,3,4,5,6,7].forEach(i=>getBtnEl(i).classList.toggle('active', n===i));
```

Substitua por:

```js
  [1,2,3,4,5,6,7,8].forEach(i=>getBtnEl(i).classList.toggle('active', n===i));
```

Localize:

```js
    if (targetN<1 || targetN>7) { phase='edge'; return; }
```

Substitua por:

```js
    if (targetN<1 || targetN>8) { phase='edge'; return; }
```

- [ ] **Step 4: Guardar os dados crus e registrar o render**

Localize dentro de `processAll()`:

```js
  PROC.rateHistory=(DB.rateHistory||[]).map(h=>({ _row:h._row, nome:String(h.nome||'').trim(), rate:Number(h.rate)||0, desde:String(h.desde||'').slice(0,10) }))
```

Insira **antes** dessa linha:

```js
  PROC.drywall=(DB.drywall||[]);
```

Localize:

```js
function renderAll() { processAll(); fillAddresses(); renderTab1(); renderTab2(); renderClientesTable(); renderInsurance(); renderUsuarios(); }
```

Substitua por:

```js
function renderAll() { processAll(); fillAddresses(); renderTab1(); renderTab2(); renderClientesTable(); renderInsurance(); renderUsuarios(); renderDrywall(); }
```

- [ ] **Step 5: Implementar a tela de lançamento**

Insira, imediatamente **antes** do bloco `// ══ DRYWALL — CÁLCULO`:

```js
// ══ TAB 8: DRYWALL — LANÇAMENTOS RÁPIDOS ══════════════════
let DW_DATA = '';        // data selecionada no formulário (YYYY-MM-DD)
function dwHojeISO() { const d=new Date(), p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }

function renderDrywall() {
  const el = document.getElementById('t8body'); if (!el) return;
  if (!DW_DATA) DW_DATA = dwHojeISO();
  const raw = PROC.drywall || [];
  const pessoas = dwPessoas(raw);
  const servicos = dwServicos(raw).slice().sort((a,b)=>a.addr.localeCompare(b.addr));
  const doDia = dwLancamentos(raw).filter(l => l.data === DW_DATA);
  const totalDia = dwRound2(doDia.reduce((s,l)=>s+l.custo,0));

  const optPessoas = ['<option value="">— escolha —</option>']
    .concat(pessoas.map(p=>`<option value="${escH(p.nome)}" data-comp="${escH(p.companhia)}" data-diaria="${p.diaria}">${escH(p.nome)}${p.companhia?' ('+escH(p.companhia)+')':''} — $${p.diaria}/dia</option>`))
    .concat(['<option value="__nova__">+ nova pessoa</option>']).join('');
  const optServicos = ['<option value="">— escolha —</option>']
    .concat(servicos.map(s=>`<option value="${escH(s.addr)}">${escH(s.addr)}${s.cliente?' — '+escH(s.cliente):''}</option>`))
    .concat(['<option value="__novo__">+ novo serviço</option>']).join('');

  const linhas = doDia.map(l=>`<tr>
      <td>${escH(l.pessoa)}</td>
      <td>${escH(l.addr)}</td>
      <td><strong>${$$(l.custo)}</strong></td>
      <td style="color:#7b8ea4">1/${l.divisor} da diária ($${l.diaria})</td>
      <td class="td-actions"><button class="row-act-btn del" onclick="dwDelete(${l._row})" title="Excluir lançamento"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="form-section mb-4">
      <div class="section-title"><i class="fas fa-bolt" style="color:var(--orange)"></i>Lançamentos Rápidos — Drywall</div>
      <p style="font-size:12.5px;color:#7b8ea4;margin-bottom:14px">Cada lançamento é uma pessoa num serviço num dia. A diária é rateada automaticamente entre os serviços que a pessoa atendeu naquele dia.</p>
      <div class="row g-3">
        <div class="col-md-3"><label class="f-label">Data</label>
          <input id="dw_data" class="f-input" type="date" value="${DW_DATA}" onchange="DW_DATA=this.value;renderDrywall()"></div>
        <div class="col-md-4"><label class="f-label">Pessoa</label>
          <select id="dw_pessoa" class="f-input" onchange="dwPessoaChange()">${optPessoas}</select></div>
        <div class="col-md-2"><label class="f-label">Diária ($)</label>
          <div class="f-input-prefix"><span class="prefix">$</span><input id="dw_diaria" class="f-input" inputmode="decimal" placeholder="200"></div></div>
        <div class="col-md-3" id="dw_compWrap" style="display:none"><label class="f-label">Companhia</label>
          <input id="dw_companhia" class="f-input" placeholder="Ex.: Drywall Pro"></div>
        <div class="col-12" id="dw_nomeWrap" style="display:none"><label class="f-label">Nome da pessoa <span class="f-req">*</span></label>
          <input id="dw_nome" class="f-input" placeholder="Ex.: Carlos"></div>

        <div class="col-md-6"><label class="f-label">Serviço</label>
          <select id="dw_serv" class="f-input" onchange="dwServChange()">${optServicos}</select></div>
        <div class="col-md-6" id="dw_cliWrap" style="display:none"><label class="f-label">Cliente <span class="f-req">*</span></label>
          <input id="dw_cliente" class="f-input" placeholder="Ex.: Maria Silva"></div>
        <div class="col-md-6" id="dw_addrWrap" style="display:none"><label class="f-label">Endereço <span class="f-req">*</span></label>
          <input id="dw_addr" class="f-input" placeholder="Ex.: 12 Oak St"></div>
        <div class="col-md-6" id="dw_valWrap" style="display:none"><label class="f-label">Valor cobrado do cliente ($) <span class="f-req">*</span></label>
          <div class="f-input-prefix"><span class="prefix">$</span><input id="dw_valor" class="f-input" inputmode="decimal" placeholder="800"></div></div>

        <div class="col-12"><label class="f-label">Observações <small style="text-transform:none;color:#7b8ea4">(opcional)</small></label>
          <input id="dw_obs" class="f-input" placeholder="Anotação livre"></div>
      </div>
      <button class="submit-btn" style="margin-top:14px;width:auto;padding:12px 22px" id="dwAddBtn" onclick="dwAdd(this)"><i class="fas fa-plus"></i> Lançar</button>
    </div>

    <div class="data-table">
      <div class="table-head"><i class="fas fa-list me-2" style="color:var(--orange)"></i>Lançamentos de ${fmtDay(DW_DATA)}</div>
      <div class="table-responsive"><table>
        <thead><tr><th>Pessoa</th><th>Serviço</th><th>Custo rateado</th><th>Rateio</th><th>Ações</th></tr></thead>
        <tbody>${linhas || `<tr><td colspan="5" style="text-align:center;color:#7b8ea4;padding:26px">Nenhum lançamento nesta data</td></tr>`}</tbody>
        ${doDia.length ? `<tfoot><tr class="tr-total"><td colspan="2">CUSTO DO DIA</td><td colspan="3"><strong>${$$(totalDia)}</strong></td></tr></tfoot>` : ''}
      </table></div>
    </div>`;
}

function dwPessoaChange() {
  const sel=document.getElementById('dw_pessoa'), nova=sel.value==='__nova__';
  document.getElementById('dw_nomeWrap').style.display=nova?'':'none';
  document.getElementById('dw_compWrap').style.display=nova?'':'none';
  const opt=sel.options[sel.selectedIndex];
  document.getElementById('dw_diaria').value = (!nova && opt && opt.dataset.diaria) ? opt.dataset.diaria : '';
  if (!nova && opt && opt.dataset.comp !== undefined) document.getElementById('dw_companhia').value = opt.dataset.comp;
}
function dwServChange() {
  const novo=document.getElementById('dw_serv').value==='__novo__';
  ['dw_cliWrap','dw_addrWrap','dw_valWrap'].forEach(id=>{ document.getElementById(id).style.display=novo?'':'none'; });
}

async function dwAdd(btn) {
  const data=document.getElementById('dw_data').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data)) { showToast('Informe a data.', true); return; }

  const selP=document.getElementById('dw_pessoa').value;
  let pessoa='', companhia='';
  if(selP==='__nova__'){ pessoa=document.getElementById('dw_nome').value.trim(); companhia=document.getElementById('dw_companhia').value.trim(); }
  else { pessoa=selP; const o=document.getElementById('dw_pessoa').selectedOptions[0]; companhia=(o&&o.dataset.comp)||''; }
  if(!pessoa){ showToast('Escolha a pessoa (ou cadastre uma nova).', true); return; }

  const diariaStr=document.getElementById('dw_diaria').value.trim().replace(',','.');
  if(!diariaStr||isNaN(parseFloat(diariaStr))||parseFloat(diariaStr)<=0){ showToast('Informe a diária.', true); return; }

  const selS=document.getElementById('dw_serv').value;
  let addr='', cliente='', valorCobrado='';
  if(selS==='__novo__'){
    addr=document.getElementById('dw_addr').value.trim();
    cliente=document.getElementById('dw_cliente').value.trim();
    const v=document.getElementById('dw_valor').value.trim().replace(',','.');
    if(!addr){ showToast('Informe o endereço do serviço.', true); return; }
    if(!cliente){ showToast('Informe o cliente.', true); return; }
    if(!v||isNaN(parseFloat(v))||parseFloat(v)<=0){ showToast('Informe o valor cobrado do cliente.', true); return; }
    valorCobrado=String(parseFloat(v));
  } else {
    addr=selS;
    if(!addr){ showToast('Escolha o serviço (ou cadastre um novo).', true); return; }
    const s=dwServicos(PROC.drywall||[]).find(x=>dwNorm(x.addr)===dwNorm(addr));
    cliente=(s&&s.cliente)||'';
  }

  await runBtn(btn, async()=>{
    try{
      await apiWrite({ action:'addDrywall', data, cliente, addr, valorCobrado, pessoa, companhia,
        diaria:String(parseFloat(diariaStr)), obs:document.getElementById('dw_obs').value.trim() });
      DW_DATA=data;
      showToast('Lançamento registrado');
      await loadData();
    }catch(e){ showToast(e.message, true); }
  }, 'Lançando...');
}

async function dwDelete(rowNum) {
  if(!confirm('Excluir este lançamento?\n\nO rateio dos outros lançamentos do mesmo dia será recalculado.')) return;
  try{ await apiWrite({action:'deleteDrywall',rowNum}); showToast('Lançamento excluído'); await loadData(); }
  catch(e){ showToast(e.message, true); }
}
```

- [ ] **Step 6: Rodar o teste do bloco puro (garante que nada quebrou)**

Run: `node scripts/test-drywall-calc.js`
Expected: `10 testes passaram.`

- [ ] **Step 7: Validar sintaxe e balanceamento**

Run:
```bash
cd "c:\Users\Felip\OneDrive\Área de Trabalho\AI\PASTA VS CODER"
node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');
fs.writeFileSync('_chk.js',js);
const o=(html.match(/<div\b/g)||[]).length,c=(html.match(/<\/div>/g)||[]).length;
console.log('divs open=%d close=%d',o,c);
"
node --check _chk.js && echo "JS OK" ; rm -f _chk.js
grep -c 'id="t8page"' index.html
```
Expected: divs iguais, `JS OK`, e `1`.

---

### Task 5: Sub-abas em Controle de Obras + lista Drywall do mês

**Files:**
- Modify: `index.html` (`t1page`, `renderTab1`)

**Interfaces:**
- Consumes: `dwServicosDoMes`, `dwTotais` (Task 3); `PROC.drywall` (Task 4)
- Produces: `showObrasSub(w)`, `renderObrasDrywall()`, `dwMesNav(delta)`

- [ ] **Step 1: Reestruturar a página 1 com sub-abas**

Localize:

```html
  <div id="t1page" class="page">
    <div class="toolbar">
```

Substitua por:

```html
  <div id="t1page" class="page">
    <div class="subtab-nav">
      <button class="subtab-btn active" id="st1bathBtn" onclick="showObrasSub('bath')"><i class="fas fa-bath"></i> Obras Bathroom/Tile</button>
      <button class="subtab-btn" id="st1dwBtn" onclick="showObrasSub('dw')"><i class="fas fa-trowel-bricks"></i> Obras Drywall</button>
    </div>
    <div id="st1bath">
    <div class="toolbar">
```

Localize (fim da página 1):

```html
    <div id="t1body"><div class="loading-box"><div class="spinner"></div>Carregando dados...</div></div>
  </div>
```

Substitua por:

```html
    <div id="t1body"><div class="loading-box"><div class="spinner"></div>Carregando dados...</div></div>
    </div>
    <div id="st1dw" style="display:none"></div>
  </div>
```

- [ ] **Step 2: Implementar a troca de sub-aba e a lista**

Insira, imediatamente **antes** do bloco `// ══ TAB 8: DRYWALL — LANÇAMENTOS RÁPIDOS`:

```js
// ══ TAB 1 — SUB-ABAS: Bathroom/Tile x Drywall ═════════════
let OBRAS_SUB = 'bath';
let DW_MES = '';   // 'YYYY-MM' exibido na lista de Obras Drywall
function showObrasSub(w) {
  OBRAS_SUB = w;
  document.getElementById('st1bathBtn').classList.toggle('active', w === 'bath');
  document.getElementById('st1dwBtn').classList.toggle('active', w === 'dw');
  document.getElementById('st1bath').style.display = w === 'bath' ? '' : 'none';
  document.getElementById('st1dw').style.display = w === 'dw' ? '' : 'none';
  if (w === 'dw') renderObrasDrywall();
}
function dwMesNav(delta) {
  const [y, m] = DW_MES.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1), p = n => String(n).padStart(2, '0');
  DW_MES = d.getFullYear() + '-' + p(d.getMonth() + 1);
  renderObrasDrywall();
}
const DW_MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
function renderObrasDrywall() {
  const el = document.getElementById('st1dw'); if (!el) return;
  if (!DW_MES) { const d = new Date(), p = n => String(n).padStart(2, '0'); DW_MES = d.getFullYear() + '-' + p(d.getMonth() + 1); }
  const servicos = dwServicosDoMes(PROC.drywall || [], DW_MES);
  const t = dwTotais(servicos);
  const [yy, mm] = DW_MES.split('-');

  const linhas = servicos.map(s => `<tr>
      <td>${escH(s.cliente || '—')}</td>
      <td><strong>${escH(s.addr)}</strong></td>
      <td style="color:#16a085;font-weight:700">${$$(s.receita)}</td>
      <td style="color:#e74c3c;font-weight:700">${$$(s.custo)}</td>
      <td style="font-weight:800;color:${s.lucro >= 0 ? '#16a085' : '#e74c3c'}">${$$(s.lucro)}</td>
    </tr>`).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;background:var(--navy);border-radius:14px;padding:10px 12px;margin-bottom:16px">
      <button class="orc-edit-btn" style="font-size:18px;padding:6px 12px" onclick="dwMesNav(-1)" aria-label="Mês anterior">&lsaquo;</button>
      <div style="flex:1;text-align:center;color:#fff;font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase">${DW_MESES[+mm-1]} <b style="color:var(--orange)">${yy}</b></div>
      <button class="orc-edit-btn" style="font-size:18px;padding:6px 12px" onclick="dwMesNav(1)" aria-label="Próximo mês">&rsaquo;</button>
    </div>
    <div class="row g-3 mb-4">
      <div class="col-6 col-xl-3"><div class="metric-card c-mat"><div class="m-label">Receita</div><div class="m-value">${$$(t.receita)}</div><div class="m-sub">${servicos.length} serviço${servicos.length===1?'':'s'}</div></div></div>
      <div class="col-6 col-xl-3"><div class="metric-card c-labor"><div class="m-label">Custo (diárias)</div><div class="m-value">${$$(t.custo)}</div><div class="m-sub">rateado por dia</div></div></div>
      <div class="col-6 col-xl-3"><div class="metric-card c-total"><div class="m-label">Lucro</div><div class="m-value">${$$(t.lucro)}</div><div class="m-sub">receita − custo</div></div></div>
      <div class="col-6 col-xl-3"><div class="metric-card c-extra"><div class="m-label">Margem</div><div class="m-value">${t.margem.toFixed(1)}%</div><div class="m-sub">sobre a receita</div></div></div>
    </div>
    <div class="data-table">
      <div class="table-head"><i class="fas fa-trowel-bricks me-2" style="color:var(--orange)"></i>Serviços de drywall</div>
      <div class="table-responsive"><table>
        <thead><tr><th>Cliente</th><th>Endereço</th><th>Receita</th><th>Custo</th><th>Lucro</th></tr></thead>
        <tbody>${linhas || `<tr><td colspan="5" style="text-align:center;color:#7b8ea4;padding:26px">Nenhum serviço de drywall neste mês</td></tr>`}</tbody>
        ${servicos.length ? `<tfoot><tr class="tr-total"><td colspan="2">TOTAL</td><td>${$$(t.receita)}</td><td>${$$(t.custo)}</td><td>${$$(t.lucro)}</td></tr></tfoot>` : ''}
      </table></div>
    </div>
    <p style="font-size:11.5px;color:#7b8ea4;margin-top:12px">Um serviço aparece no mês em que começou, com receita e custo integrais — mesmo que alguma diária tenha caído no mês seguinte.</p>`;
}
```

- [ ] **Step 3: Fazer o render da aba 1 respeitar a sub-aba ativa**

Localize:

```js
function renderTab1() {
  const body=document.getElementById('t1body');
```

Substitua por:

```js
function renderTab1() {
  if (OBRAS_SUB === 'dw') renderObrasDrywall();
  const body=document.getElementById('t1body');
```

- [ ] **Step 4: Rodar o teste do bloco puro**

Run: `node scripts/test-drywall-calc.js`
Expected: `10 testes passaram.`

- [ ] **Step 5: Validar sintaxe e balanceamento**

Run:
```bash
cd "c:\Users\Felip\OneDrive\Área de Trabalho\AI\PASTA VS CODER"
node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const js=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');
fs.writeFileSync('_chk.js',js);
const o=(html.match(/<div\b/g)||[]).length,c=(html.match(/<\/div>/g)||[]).length;
console.log('divs open=%d close=%d',o,c);
"
node --check _chk.js && echo "JS OK" ; rm -f _chk.js
```
Expected: divs iguais e `JS OK`. Se estiverem desiguais, revise os `<div>` abertos no Step 1 (`st1bath` e `st1dw`).

---

### Task 6: Publicar e verificar em produção

**Files:**
- Nenhum arquivo novo — publica `api/_actions.js`, `api/write.js`, `api/_google.js`, `index.html`, `scripts/test-drywall-calc.js`, `docs/superpowers/specs/2026-08-11-lancamentos-rapidos-drywall-design.md` e `docs/superpowers/plans/2026-08-11-lancamentos-rapidos-drywall.md`

**Interfaces:**
- Consumes: tudo das Tasks 1–5
- Produces: feature no ar em `https://dashboard-gamma-beryl-22.vercel.app/`

- [ ] **Step 1: Validação final antes do push**

Run:
```bash
cd "c:\Users\Felip\OneDrive\Área de Trabalho\AI\PASTA VS CODER"
for f in api/_actions.js api/write.js api/_google.js; do node --check "$f" || exit 1; done
node scripts/test-drywall-calc.js || exit 1
ls api/*.js | grep -v '_' | wc -l
```
Expected: teste passa e a contagem de funções é `12`.

- [ ] **Step 2: Push em commit único**

```bash
TOKEN=$(cat "/c/Users/Felip/.njr-github-token")
cd "c:\Users\Felip\OneDrive\Área de Trabalho\AI\PASTA VS CODER"
API="https://api.github.com/repos/NJRBathrooms/Dashboard"

BASE_SHA=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/git/refs/heads/main" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).object.sha));")
BASE_TREE=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/git/commits/$BASE_SHA" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).tree.sha));")

FILES="api/_actions.js api/write.js api/_google.js index.html scripts/test-drywall-calc.js docs/superpowers/specs/2026-08-11-lancamentos-rapidos-drywall-design.md docs/superpowers/plans/2026-08-11-lancamentos-rapidos-drywall.md"
TREE_ITEMS=""
for f in $FILES; do
  node -e "const fs=require('fs');fs.writeFileSync('_b.json',JSON.stringify({content:fs.readFileSync('$f','utf8'),encoding:'utf-8'}));"
  SHA=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/git/blobs" -d @_b.json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).sha));")
  echo "blob $f -> $SHA"
  TREE_ITEMS="$TREE_ITEMS $f:$SHA"
done
rm -f _b.json

node -e "
const fs=require('fs');
const items=process.argv[1].trim().split(/\s+/).map(s=>{const i=s.lastIndexOf(':');return {path:s.slice(0,i),mode:'100644',type:'blob',sha:s.slice(i+1)};});
fs.writeFileSync('_t.json',JSON.stringify({base_tree:process.argv[2],tree:items}));
" "$TREE_ITEMS" "$BASE_TREE"
NEW_TREE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/git/trees" -d @_t.json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).sha));")
rm -f _t.json

node -e "
const fs=require('fs');
fs.writeFileSync('_c.json',JSON.stringify({message:'feat(drywall): lancamentos rapidos com rateio de diaria + subabas em Controle de Obras',tree:process.argv[1],parents:[process.argv[2]]}));
" "$NEW_TREE" "$BASE_SHA"
NEW_COMMIT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/git/commits" -d @_c.json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).sha));")
rm -f _c.json
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" "$API/git/refs/heads/main" -d "{\"sha\":\"$NEW_COMMIT\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('ref ->',j.object&&j.object.sha);});"
```
Expected: `ref ->` com o SHA do novo commit.

- [ ] **Step 3: Aguardar o deploy**

```bash
TOKEN=$(cat "/c/Users/Felip/.njr-github-token")
until curl -s -H "Authorization: Bearer $TOKEN" "https://api.github.com/repos/NJRBathrooms/Dashboard/commits/main/status" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(j.state);process.exit(j.state==='pending'?1:0);});"; do sleep 5; done
echo "DEPLOY DONE"
```
Expected: `success` seguido de `DEPLOY DONE`. Se sair `failure`, o build quebrou — checar o limite de 12 funções.

- [ ] **Step 4: Smoke test em produção — criar, conferir o rateio e limpar**

```powershell
$base = "https://dashboard-gamma-beryl-22.vercel.app"
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Uri "$base/api/login" -Method Post -Body (@{password="NJR2026"} | ConvertTo-Json) -ContentType "application/json" -WebSession $s | Out-Null

# 3 lançamentos do mesmo teste no mesmo dia (diária 200 -> 66.67/66.67/66.66)
Invoke-RestMethod -Uri "$base/api/write" -Method Post -ContentType "application/json; charset=utf-8" -WebSession $s -Body ([System.Text.Encoding]::UTF8.GetBytes((@{action="addDrywall";data="2026-01-02";cliente="TESTE CLAUDE";addr="ZZ Teste 1";valorCobrado="800";pessoa="ZZ Teste Pessoa";companhia="ZZ Co";diaria="200"} | ConvertTo-Json))) | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$base/api/write" -Method Post -ContentType "application/json; charset=utf-8" -WebSession $s -Body ([System.Text.Encoding]::UTF8.GetBytes((@{action="addDrywall";data="2026-01-02";cliente="TESTE CLAUDE";addr="ZZ Teste 2";valorCobrado="600";pessoa="ZZ Teste Pessoa";companhia="ZZ Co";diaria="200"} | ConvertTo-Json))) | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$base/api/write" -Method Post -ContentType "application/json; charset=utf-8" -WebSession $s -Body ([System.Text.Encoding]::UTF8.GetBytes((@{action="addDrywall";data="2026-01-02";cliente="TESTE CLAUDE";addr="ZZ Teste 3";valorCobrado="950";pessoa="ZZ Teste Pessoa";companhia="ZZ Co";diaria="200"} | ConvertTo-Json))) | ConvertTo-Json -Compress

# 2ª diária no MESMO endereço 1 -> receita não pode dobrar
Invoke-RestMethod -Uri "$base/api/write" -Method Post -ContentType "application/json; charset=utf-8" -WebSession $s -Body ([System.Text.Encoding]::UTF8.GetBytes((@{action="addDrywall";data="2026-01-03";cliente="TESTE CLAUDE";addr="ZZ Teste 1";valorCobrado="800";pessoa="ZZ Teste Pessoa";companhia="ZZ Co";diaria="200"} | ConvertTo-Json))) | ConvertTo-Json -Compress

$d = Invoke-RestMethod -Uri "$base/api/data" -Method Get -WebSession $s
$d.drywall | Where-Object { $_.addr -like "ZZ Teste*" } | Select-Object _row,data,addr,valorCobrado,pessoa,diaria | Format-Table -AutoSize | Out-String -Width 200
```
Expected: 4 linhas. A linha do dia 2026-01-03 em `ZZ Teste 1` deve ter `valorCobrado` **vazio** (a receita já existia) — essa é a verificação central da integridade.

- [ ] **Step 5: Limpar os dados de teste**

```powershell
$base = "https://dashboard-gamma-beryl-22.vercel.app"
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Uri "$base/api/login" -Method Post -Body (@{password="NJR2026"} | ConvertTo-Json) -ContentType "application/json" -WebSession $s | Out-Null
$d = Invoke-RestMethod -Uri "$base/api/data" -Method Get -WebSession $s
# exclui de baixo para cima, senão as linhas deslocam
$d.drywall | Where-Object { $_.addr -like "ZZ Teste*" } | Sort-Object _row -Descending | ForEach-Object {
  Invoke-RestMethod -Uri "$base/api/write" -Method Post -ContentType "application/json" -WebSession $s -Body (@{action="deleteDrywall";rowNum=$_._row} | ConvertTo-Json) | Out-Null
  Write-Output "excluida linha $($_._row)"
}
$d2 = Invoke-RestMethod -Uri "$base/api/data" -Method Get -WebSession $s
Write-Output "restantes: $(($d2.drywall | Where-Object { $_.addr -like 'ZZ Teste*' }).Count)"
```
Expected: `restantes: 0`.

- [ ] **Step 6: Conferir a UI no ar**

```bash
curl -s "https://dashboard-gamma-beryl-22.vercel.app/" | grep -o "Lançamentos Rápidos — Drywall\|Obras Bathroom/Tile\|Obras Drywall\|dwLancamentos" | sort -u
```
Expected: as quatro strings presentes.

---

## Self-Review

**Cobertura do spec:**

| Requisito do spec | Task |
|---|---|
| Aba `Drywall` com as 9 colunas exatas | 2 |
| Criação automática da aba | 2 |
| Receita gravada uma única vez (defesa no servidor) | 2 |
| `readAll` devolve `drywall` normalizado | 2 |
| Rateio da diária por pessoa+dia | 3 |
| Receita = primeiro valor não-vazio (nunca soma) | 3 |
| Diária como snapshot | 3 (teste 8) |
| Chaves normalizadas (endereço/pessoa) | 3 (teste 6) |
| Lista de pessoas derivada do histórico | 3, 4 |
| Serviço pertence ao mês de início, com custo integral | 3 (teste 10), 5 |
| Tela de lançamento rápido com todos os campos | 4 |
| Observações (opcional) no formulário | 4 |
| Sub-abas Bathroom/Tile e Drywall | 5 |
| Lista do mês com totais e margem | 5 |
| Guarda de duplo toque no `index.html` | 1 |
| Limite de 12 funções serverless | 2 (Step 6), 6 (Step 1) |
| Nenhuma alteração no fluxo Bathroom/Tile | 5 (Step 1 preserva o conteúdo original dentro de `st1bath`) |

**Verificações do spec cobertas por teste automatizado:** itens 1, 2, 3, 4, 5, 6, 6b do spec → testes 1–10 da Task 3. Item 7 (duplo toque) → Task 1. Item 8 (sem regressão em Bathroom/Tile) → Task 5 Step 5 + inspeção visual. Item 9 → Tasks 2/6.

**Consistência de tipos:** `dwLancamentos`/`dwServicos`/`dwPessoas`/`dwServicosDoMes`/`dwTotais` são declaradas na Task 3 e consumidas com os mesmos nomes e shapes nas Tasks 4 e 5. `PROC.drywall` é populado na Task 4 Step 4 e lido nas Tasks 4 e 5. `runBtn` é declarado na Task 1 e usado na Task 4.

**Risco conhecido:** a Task 5 Step 1 abre dois `<div>` novos e fecha um; o Step 5 checa o balanceamento. Se falhar, é aí.

**Classes CSS conferidas contra o `index.html`** (não reutilizar as do `rentals.html`, que são diferentes): as usadas no plano — `metric-card`, `c-total`, `c-labor`, `c-mat`, `c-extra`, `m-label`, `m-value`, `m-sub`, `data-table`, `table-head`, `table-responsive`, `tr-total`, `form-section`, `section-title`, `f-input`, `f-label`, `f-req`, `f-input-prefix`, `submit-btn`, `row-act-btn`, `td-actions`, `subtab-nav`, `subtab-btn`, `loading-box`, `spinner`, `orc-edit-btn` — todas existem. **Não existem** no `index.html`: `stat-card`, `stat-label`, `stat-value`, `metric-row`, `mnav`, `mnav-arw` — se aparecerem em alguma edição, é erro.
