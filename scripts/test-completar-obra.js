// Testa completarObra / updateObra (reabrir) / closeObra contra uma planilha
// simulada, com os mesmos cabeçalhos da produção.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const HEADERS = ['Endereço','Nome do Cliente','Contato','Escopo','Orçamento','Data Início Prevista','Data Fim Prevista','Link Fotos Antes','Finalizada','Data Finalização','Link Fotos Depois'];
let SHEET, appended, updated;

function reset() {
  SHEET = [HEADERS.slice(),
    ['66 Knotty way Belmont NH','','','','','','','','Sim','2026-01-10',''],
    ['4 Tara rd, Essex','Andrew cabinet by design','','','6240','','','','Não','','']];
  appended = []; updated = [];
}

const gpath = path.join(ROOT, 'api', '_google.js');
require.cache[require.resolve(gpath)] = { id: gpath, filename: gpath, loaded: true, exports: {
  normStr: s => String(s||'').trim().toLowerCase().replace(/\s+/g,' '),
  loadSheetIndex: async () => ({ tz:'America/New_York', index:[{ title:'Cadastro de Obras', sheetId:1, headers:HEADERS }] }),
  findSheetEntry: (index, kws) => index.find(s => kws.every(k => s.headers.some(h => h.toLowerCase().includes(k)))) || null,
  readColumn: async (t, i) => SHEET.map(r => r[i]),
  buildRow: (headers, mapping) => { const row=new Array(headers.length).fill('');
    for (const m of mapping) { if (m.val===undefined) continue; let v=m.val;
      if (m.forceText && v!=='' && v!=null) v="'"+String(v);
      const i = m.fuzzy ? headers.findIndex(h=>h.toLowerCase().includes(m.key.toLowerCase())) : headers.indexOf(m.key);
      if (i>=0) row[i]=v; } return row; },
  appendRow: async (t, row) => { appended.push(row); SHEET.push(row); },
  updateRowCells: async (t, rowNum, headers, ups) => { ups.forEach(u=>{ const i=headers.indexOf(u.key); if(i>=0){ SHEET[rowNum-1][i]=u.val; updated.push([rowNum,u.key,u.val]); } }); },
}};

const A = require(path.join(ROOT, 'api', '_actions.js'));

let pass=0, fail=0;
const eq=(name,a,b)=>{ const ok=JSON.stringify(a)===JSON.stringify(b);
  if(ok){pass++;} else {fail++;console.log('  FALHOU: '+name+'\n    esperado '+JSON.stringify(b)+'\n    obtido   '+JSON.stringify(a));} };

(async () => {
  // 1. obra COM linha, só faltando cliente e estimate → atualiza, não cria
  reset();
  let r = await A.completarObra({ addr:'66 Knotty way Belmont NH', cliente:'Bob Smith', orcamento:'5200' });
  eq('1 retorno', r, { ok:true, created:false });
  eq('1 nada criado', appended.length, 0);
  eq('1 cliente gravado', SHEET[1][1], 'Bob Smith');
  eq('1 estimate gravado', SHEET[1][4], 5200);
  eq('1 status intocado', [SHEET[1][8], SHEET[1][9]], ['Sim','2026-01-10']);

  // 2. obra SEM linha, já concluída → cria com status Sim + data
  reset();
  r = await A.completarObra({ addr:'14 Bradford road Hamilton', cliente:'John Doe', orcamento:'3400', finalizada:'Sim', dtFinal:'2026-03-15' });
  eq('2 retorno', r, { ok:true, created:true });
  eq('2 linha criada', appended.length, 1);
  eq('2 conteúdo', appended[0], ['14 Bradford road Hamilton','John Doe','','',3400,'','','','Sim','2026-03-15','']);

  // 3. obra SEM linha, em andamento → cria sem data de finalização
  reset();
  r = await A.completarObra({ addr:'50 Tobey St Providence', cliente:'Ana', orcamento:'900', finalizada:'Não' });
  eq('3 criada em andamento', appended[0][8], 'Não');
  eq('3 sem data final', appended[0][9], '');

  // 4. concluída sem data → recusa
  reset();
  r = await A.completarObra({ addr:'50 Tobey St Providence', cliente:'Ana', finalizada:'Sim' });
  eq('4 recusa sem data', !!r.error, true);
  eq('4 nada gravado', appended.length, 0);

  // 5. nada informado → recusa
  reset();
  r = await A.completarObra({ addr:'50 Tobey St Providence' });
  eq('5 recusa vazio', !!r.error, true);

  // 6. estimate zero/negativo → recusa
  reset();
  eq('6 recusa zero', !!(await A.completarObra({ addr:'50 Tobey St Providence', orcamento:'0' })).error, true);
  eq('6 recusa negativo', !!(await A.completarObra({ addr:'50 Tobey St Providence', orcamento:'-5' })).error, true);

  // 7. só estimate, sem cliente → aceita e NÃO apaga o cliente existente
  reset();
  r = await A.completarObra({ addr:'4 Tara rd, Essex', orcamento:'7000' });
  eq('7 retorno', r, { ok:true, created:false });
  eq('7 cliente preservado', SHEET[2][1], 'Andrew cabinet by design');
  eq('7 estimate atualizado', SHEET[2][4], 7000);

  // 8. endereço com caixa/espaço diferentes casa com a linha existente
  reset();
  r = await A.completarObra({ addr:'66 knotty  WAY belmont nh', cliente:'X' });
  eq('8 casou sem criar', r, { ok:true, created:false });
  eq('8 nada criado', appended.length, 0);

  // 9. arredondamento de centavos
  reset();
  await A.completarObra({ addr:'14 Bradford road Hamilton', orcamento:'1234.567' });
  eq('9 round2', appended[0][4], 1234.57);

  // 10. endereço vazio → recusa
  eq('10 recusa sem endereço', !!(await A.completarObra({ cliente:'X' })).error, true);
  // ── reabrir obra: updateObra escrevendo Finalizada/Data Finalização ──
  // (esse caminho do updateObra nunca tinha sido usado — só o de orçamento)
  reset();
  r = await A.updateObra({ addr:'66 Knotty way Belmont NH', finalizada:'Não', dtFinal:'' });
  eq('11 reabrir retorno', r, { ok:true });
  eq('11 marcada como não finalizada', SHEET[1][8], 'Não');
  eq('11 data de finalização limpa', SHEET[1][9], '');
  eq('11 nada foi criado', appended.length, 0);

  // 12. reabrir não mexe em cliente, estimate nem fotos
  reset();
  SHEET[1][1]='Bob'; SHEET[1][4]=5200; SHEET[1][10]='http://drive/depois';
  await A.updateObra({ addr:'66 Knotty way Belmont NH', finalizada:'Não', dtFinal:'' });
  eq('12 cliente preservado', SHEET[1][1], 'Bob');
  eq('12 estimate preservado', SHEET[1][4], 5200);
  eq('12 fotos preservadas', SHEET[1][10], 'http://drive/depois');

  // 13. encerrar de volta restaura o estado anterior
  reset();
  await A.updateObra({ addr:'66 Knotty way Belmont NH', finalizada:'Não', dtFinal:'' });
  await A.closeObra({ addr:'66 Knotty way Belmont NH', dtFinal:'2026-01-10' });
  eq('13 volta a finalizada', [SHEET[1][8], SHEET[1][9]], ['Sim','2026-01-10']);
  eq('13 sem linha duplicada', appended.length, 0);

  // 14. encerrar endereço sem cadastro cria a linha mínima (comportamento do closeObra)
  reset();
  r = await A.closeObra({ addr:'14 Bradford road Hamilton', dtFinal:'2026-04-01' });
  eq('14 criada', r, { ok:true, created:true });
  eq('14 conteúdo', [appended[0][0], appended[0][8], appended[0][9]], ['14 Bradford road Hamilton','Sim','2026-04-01']);


  console.log('\n' + pass + ' asserções passaram, ' + fail + ' falharam.');
  process.exit(fail ? 1 : 0);
})();
