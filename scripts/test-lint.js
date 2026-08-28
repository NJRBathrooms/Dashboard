// Lint dos apps de página única: procura chamadas a funções que não existem.
//
// Existe porque `node --check` só valida sintaxe. Em 28/08/2026 a aba Drywall foi
// ao ar quebrada porque um patch aplicado com String.replace(from, to) transformou
// $$( (formatador de moeda) em $( — sintaxe válida, função inexistente. Passou no
// --check e só estourou no navegador.
//
// O truque é ignorar comentários, strings e regex, MAS analisar o interior de
// ${...} dos template literals, que é onde mora quase todo o HTML gerado do app —
// e onde o bug estava.
//
// Rodar: node scripts/test-lint.js
const fs = require('fs');
const path = require('path');

const BS = String.fromCharCode(92); // barra invertida, sem escape em literal

// Remove comentários, strings e regex, preservando o código dentro de ${...}
// e as quebras de linha (para os números de linha continuarem batendo).
function stripNonCode(src) {
  const out = new Array(src.length).fill(' ');
  const nl = i => { if (src[i] === '\n') out[i] = '\n'; };

  let i = 0;
  const stack = [{ mode: 'code', depth: 0 }];
  let lastSig = '';

  while (i < src.length) {
    const top = stack[stack.length - 1];
    const c = src[i];
    const c2 = c + (src[i + 1] || '');

    if (top.mode === 'code') {
      if (c2 === '//') { while (i < src.length && src[i] !== '\n') { nl(i); i++; } continue; }
      if (c2 === '/*') {
        i += 2;
        while (i < src.length && src[i] + (src[i + 1] || '') !== '*/') { nl(i); i++; }
        i += 2; continue;
      }
      if (c === '"' || c === "'") {
        const q = c; nl(i); i++;
        while (i < src.length && src[i] !== q) {
          if (src[i] === BS) { nl(i); i++; }
          nl(i); i++;
        }
        i++; lastSig = 'x'; continue;
      }
      if (c === '`') { stack.push({ mode: 'tpl' }); i++; continue; }
      if (c === '/' && isRegexPos(lastSig)) {
        i++;
        let cls = false;
        while (i < src.length) {
          const ch = src[i];
          if (ch === BS) { i += 2; continue; }
          if (ch === '[') cls = true;
          else if (ch === ']') cls = false;
          else if (ch === '/' && !cls) break;
          else if (ch === '\n') break;
          i++;
        }
        i++;
        while (i < src.length && /[a-z]/.test(src[i])) i++;
        lastSig = 'x'; continue;
      }
      if (c === '}' && stack.length > 1) {
        if (top.depth === 0) { stack.pop(); i++; continue; } // fecha o ${...}
        top.depth--;
      }
      if (c === '{' && stack.length > 1) top.depth++;
      out[i] = c;
      if (!/\s/.test(c)) lastSig = /[\w$]/.test(c) ? (/[\w$]/.test(lastSig) ? lastSig + c : c) : c;
      i++; continue;
    }

    // dentro de template literal: o texto é ignorado; ${ reabre código
    if (c === BS) { nl(i); nl(i + 1); i += 2; continue; }
    if (c === '`') { stack.pop(); i++; continue; }
    if (c2 === '${') { stack.push({ mode: 'code', depth: 0 }); i += 2; lastSig = '('; continue; }
    nl(i); i++;
  }
  return out.join('');
}

// Depois destes tokens, uma "/" começa um literal de regex (não é divisão)
function isRegexPos(prev) {
  if (!prev) return true;
  if (/^[({[,;=:!&|?+*%~^<>-]$/.test(prev)) return true;
  return ['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'delete', 'void', 'instanceof'].includes(prev);
}

const GLOBAIS = new Set(`
Object Array String Number Boolean Math JSON Date RegExp Error TypeError RangeError SyntaxError
Promise Map Set WeakMap WeakSet Symbol Proxy Reflect BigInt Function eval
parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI
setTimeout setInterval clearTimeout clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask
fetch alert confirm prompt print console document window navigator localStorage sessionStorage
location history screen FormData Blob File FileReader URL URLSearchParams Image Audio Option
XMLHttpRequest Event CustomEvent MutationObserver IntersectionObserver AbortController Notification
Intl TextEncoder TextDecoder atob btoa structuredClone Uint8Array Int8Array Float32Array ArrayBuffer
open close focus blur scrollTo getComputedStyle matchMedia
Chart ChartDataLabels bootstrap
if for while switch catch return function class typeof new delete void await async
`.trim().split(/\s+/));

function declarados(code) {
  const d = new Set();
  const res = [
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
    /,\s*([A-Za-z_$][\w$]*)\s*=/g,
    /([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/g,
    /([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    /([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/g,
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
  ];
  for (const re of res) for (const m of code.matchAll(re)) d.add(m[1]);
  // parâmetros de funções e arrows
  for (const m of code.matchAll(/\(([^()]{0,300})\)\s*(?:=>|\{)/g)) {
    m[1].split(',').forEach(p => {
      const n = p.trim().replace(/=[\s\S]*$/, '').replace(/^\.\.\./, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) d.add(n);
    });
  }
  for (const m of code.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/gm)) d.add(m[1]);
  return d;
}

function analisar(file) {
  const html = fs.readFileSync(file, 'utf8');
  const blocos = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const bruto = blocos.join('\n');
  if (!bruto.trim()) return { file, achados: [], linhas: 0 };

  const code = stripNonCode(bruto);
  const decl = declarados(code);
  const linhas = code.split('\n');
  const brutoLinhas = bruto.split('\n');

  const achados = [];
  const vistos = new Set();
  linhas.forEach((linha, i) => {
    for (const m of linha.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const nome = m[1];
      if (GLOBAIS.has(nome) || decl.has(nome) || vistos.has(nome)) continue;
      vistos.add(nome);
      achados.push({ nome, linha: i + 1, trecho: (brutoLinhas[i] || '').trim().slice(0, 100) });
    }
  });
  return { file, achados, linhas: linhas.length };
}

const raiz = path.join(__dirname, '..');
const ARQUIVOS = ['index.html', 'rentals.html', 'employees.html', 'subcontractors.html'];

let total = 0;
for (const f of ARQUIVOS) {
  const r = analisar(path.join(raiz, f));
  if (!r.achados.length) {
    console.log('  ok  ' + f + ' — nenhuma chamada a função inexistente (' + r.linhas + ' linhas de script)');
  } else {
    console.log('  FALHOU  ' + f + ':');
    r.achados.forEach(a => { total++; console.log('        L' + a.linha + '  ' + a.nome + '()  ->  ' + a.trecho); });
  }
}
console.log(total ? '\n' + total + ' chamada(s) suspeita(s).' : '\nlint ok.');
process.exit(total ? 1 : 0);
