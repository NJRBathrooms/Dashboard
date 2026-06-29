// ============================================================
// NJR Bathrooms — ações de escrita na planilha (via Sheets API)
// Porte fiel das funções do Apps Script (addObra, closeObra, addMaterial, etc.)
// ============================================================

const G = require('./_google');

const KW = {
  obras:   ['nome do cliente', 'orçamento'],
  mats:    ['data da compra', 'descrição dos itens'],
  subs:    ['empresa subcontratada', 'valor do serviço'],
  clientes:['contato do cliente', 'email do cliente'],
  labor:   ['nome do funcionário', 'hora de entrada'],
};

function addrColIndex(headers) {
  const i = headers.findIndex(h => G.normStr(h).includes('endere'));
  return i < 0 ? 0 : i;
}
const round2 = v => Math.round(parseFloat(v) * 100) / 100;

// ── OBRAS ─────────────────────────────────────────────────
async function addObra(params) {
  const { index } = await G.loadSheetIndex();
  const sh = G.findSheetEntry(index, KW.obras);
  if (!sh) return { error: 'Aba "Cadastro de Obras" não encontrada. Crie a aba com os cabeçalhos corretos.' };
  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };

  const aIdx = addrColIndex(sh.headers);
  const col = await G.readColumn(sh.title, aIdx);
  if (col.slice(1).some(v => G.normStr(v) === G.normStr(addr))) {
    return { error: 'Já existe uma obra cadastrada para esse endereço.' };
  }

  const row = G.buildRow(sh.headers, [
    { key: 'endere', fuzzy: true, val: addr },
    { key: 'Nome do Cliente', val: params.cliente || '' },
    { key: 'Contato', val: params.contato || '', forceText: true },
    { key: 'Escopo', val: params.escopo || '' },
    { key: 'Orçamento', val: params.orcamento ? parseFloat(params.orcamento) : '' },
    { key: 'Data Início Prevista', val: params.dtInicio || '' },
    { key: 'Data Fim Prevista', val: params.dtFim || '' },
    { key: 'Link Fotos Antes', val: params.fotosBefore || '' },
    { key: 'Finalizada', val: 'Não' },
  ]);
  await G.appendRow(sh.title, row);
  return { ok: true };
}

async function closeObra(params) {
  const { index } = await G.loadSheetIndex();
  const sh = G.findSheetEntry(index, KW.obras);
  if (!sh) return { error: 'Aba "Cadastro de Obras" não encontrada.' };
  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };

  let headers = sh.headers.slice();
  const aIdx = addrColIndex(headers);
  const col = await G.readColumn(sh.title, aIdx);

  // garante a coluna "Link Fotos Depois" se houver foto e ela não existir
  const ensureFotosDepois = async () => {
    let c = headers.indexOf('Link Fotos Depois');
    if (c < 0 && params.fotosAfter) {
      c = headers.length;
      await G.updateCell(sh.title, 1, c, 'Link Fotos Depois');
      headers.push('Link Fotos Depois');
    }
    return c;
  };

  for (let i = 1; i < col.length; i++) {
    if (G.normStr(col[i]) === G.normStr(addr)) {
      const rowNum = i + 1;
      const updates = [
        { key: 'Finalizada', val: 'Sim' },
        { key: 'Data Finalização', val: params.dtFinal || '' },
      ];
      if (params.fotosAfter) {
        await ensureFotosDepois();
        updates.push({ key: 'Link Fotos Depois', val: params.fotosAfter });
      }
      await G.updateRowCells(sh.title, rowNum, headers, updates);
      return { ok: true };
    }
  }

  // obra não cadastrada antes — cria linha mínima já finalizada
  if (params.fotosAfter) await ensureFotosDepois();
  const row = G.buildRow(headers, [
    { key: headers[aIdx], val: addr },
    { key: 'Finalizada', val: 'Sim' },
    { key: 'Data Finalização', val: params.dtFinal || '' },
    { key: 'Link Fotos Depois', val: params.fotosAfter || '' },
  ]);
  await G.appendRow(sh.title, row);
  return { ok: true, created: true };
}

async function updateObra(params) {
  const { index } = await G.loadSheetIndex();
  const sh = G.findSheetEntry(index, KW.obras);
  if (!sh) return { error: 'Aba "Cadastro de Obras" não encontrada.' };
  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };

  const aIdx = addrColIndex(sh.headers);
  const col = await G.readColumn(sh.title, aIdx);
  const fieldMap = {
    cliente: 'Nome do Cliente', contato: 'Contato', escopo: 'Escopo', orcamento: 'Orçamento',
    dtInicio: 'Data Início Prevista', dtFim: 'Data Fim Prevista', fotosBefore: 'Link Fotos Antes',
    finalizada: 'Finalizada', dtFinal: 'Data Finalização', fotosAfter: 'Link Fotos Depois',
  };
  for (let i = 1; i < col.length; i++) {
    if (G.normStr(col[i]) === G.normStr(addr)) {
      const updates = [];
      Object.entries(fieldMap).forEach(([pk, hdr]) => {
        if (params[pk] !== undefined) updates.push({ key: hdr, val: params[pk], forceText: pk === 'contato' });
      });
      await G.updateRowCells(sh.title, i + 1, sh.headers, updates);
      return { ok: true };
    }
  }
  return { error: 'Obra não encontrada para esse endereço.' };
}

// ── MATERIAIS ─────────────────────────────────────────────
async function addMaterial(params) {
  const { index } = await G.loadSheetIndex();
  const sh = G.findSheetEntry(index, KW.mats);
  if (!sh) return { error: 'Aba de materiais não encontrada. Verifique se existe uma aba com as colunas "Data da Compra" e "Descrição dos Itens".' };
  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };

  const row = G.buildRow(sh.headers, [
    { key: 'Carimbo de data/hora', val: G.nowInTz() },
    { key: 'Data da Compra', val: params.dataCom || '' },
    { key: 'Endereço da obra', val: addr },
    { key: 'É um custo extra para o cliente pagar?', val: params.isExtra || 'Não' },
    { key: 'Descrição dos Itens', val: params.desc || '' },
    { key: 'Valor Total Pago ($)', val: params.amount ? round2(params.amount) : '' },
    { key: 'Anexar Comprovante/NF', val: params.comprovante || '' },
    { key: 'Observa', fuzzy: true, val: params.obs || '' },
    { key: 'Selecione a empresa', val: params.empresa || '' },
  ]);
  await G.appendRow(sh.title, row);
  return { ok: true };
}

async function updateMaterial(params) {
  const { index } = await G.loadSheetIndex();
  const sh = G.findSheetEntry(index, KW.mats);
  if (!sh) return { error: 'Aba de materiais não encontrada.' };
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Número de linha inválido.' };
  const updates = [];
  if (params.dataCom) updates.push({ key: 'Data da Compra', val: params.dataCom });
  if (params.desc !== undefined) updates.push({ key: 'Descrição dos Itens', val: params.desc });
  if (params.amount !== undefined) updates.push({ key: 'Valor Total Pago ($)', val: params.amount ? round2(params.amount) : '' });
  if (params.isExtra !== undefined) updates.push({ key: 'É um custo extra para o cliente pagar?', val: params.isExtra });
  if (params.empresa !== undefined) updates.push({ key: 'Selecione a empresa', val: params.empresa });
  if (params.obs !== undefined) updates.push({ key: 'Observa', fuzzy: true, val: params.obs });
  await G.updateRowCells(sh.title, rowNum, sh.headers, updates);
  return { ok: true };
}

async function deleteMaterial(params) {
  const { index } = await G.loadSheetIndex();
  const sh = G.findSheetEntry(index, KW.mats);
  if (!sh) return { error: 'Aba de materiais não encontrada.' };
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Número de linha inválido.' };
  await G.deleteRow(sh.sheetId, rowNum);
  return { ok: true };
}

// ── SUBCONTRATOS ──────────────────────────────────────────
async function addSubcontrato(params) {
  const { index } = await G.loadSheetIndex();
  const sh = G.findSheetEntry(index, KW.subs);
  if (!sh) return { error: 'Aba de subcontratos não encontrada. Verifique se existe uma aba com as colunas "Empresa Subcontratada" e "Valor do serviço".' };
  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };

  const row = G.buildRow(sh.headers, [
    { key: 'Carimbo de data/hora', val: G.nowInTz() },
    { key: 'Endereço da obra', val: addr },
    { key: 'Data de conclus', fuzzy: true, val: params.dataCon || '' },
    { key: 'Tipo de serviço', val: params.tipo || '' },
    { key: 'Descrição do serviço', val: params.desc || '' },
    { key: 'Empresa Subcontratada', val: params.empresa || '' },
    { key: 'Contato do Subcontratado', val: params.contato || '', forceText: true },
    { key: 'Valor do serviço', val: params.amount ? round2(params.amount) : '' },
    { key: 'Status pagamento', val: params.status || '' },
    { key: 'invoice', fuzzy: true, val: params.invoice || '' },
  ]);
  await G.appendRow(sh.title, row);
  return { ok: true };
}

async function updateSubcontrato(params) {
  const { index } = await G.loadSheetIndex();
  const sh = G.findSheetEntry(index, KW.subs);
  if (!sh) return { error: 'Aba de subcontratos não encontrada.' };
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Número de linha inválido.' };
  const updates = [];
  if (params.dataCon) updates.push({ key: 'Data de conclus', fuzzy: true, val: params.dataCon });
  if (params.tipo !== undefined) updates.push({ key: 'Tipo de serviço', val: params.tipo });
  if (params.desc !== undefined) updates.push({ key: 'Descrição do serviço', val: params.desc });
  if (params.empresa !== undefined) updates.push({ key: 'Empresa Subcontratada', val: params.empresa });
  if (params.contato !== undefined) updates.push({ key: 'Contato do Subcontratado', val: params.contato, forceText: true });
  if (params.amount !== undefined) updates.push({ key: 'Valor do serviço', val: params.amount ? round2(params.amount) : '' });
  if (params.status !== undefined) updates.push({ key: 'Status pagamento', val: params.status });
  await G.updateRowCells(sh.title, rowNum, sh.headers, updates);
  return { ok: true };
}

async function deleteSubcontrato(params) {
  const { index } = await G.loadSheetIndex();
  const sh = G.findSheetEntry(index, KW.subs);
  if (!sh) return { error: 'Aba de subcontratos não encontrada.' };
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Número de linha inválido.' };
  await G.deleteRow(sh.sheetId, rowNum);
  return { ok: true };
}

// ── CLIENTES ──────────────────────────────────────────────
async function addCliente(params) {
  const { index } = await G.loadSheetIndex();
  let sh = G.findSheetEntry(index, KW.clientes);
  if (!sh) return { error: 'Aba "Cadastro de Clientes" não encontrada. Crie a aba com os cabeçalhos corretos.' };
  const nome = (params.nome || '').trim();
  if (!nome) return { error: 'Nome do cliente é obrigatório.' };
  const contato = (params.contato || '').trim();
  if (!contato) return { error: 'Contato do cliente é obrigatório.' };

  const row = G.buildRow(sh.headers, [
    { key: 'Carimbo de data/hora', val: G.nowInTz() },
    { key: 'Nome do Cliente', val: nome },
    { key: 'Contato do Cliente', val: contato, forceText: true },
    { key: 'Empresa do Cliente', val: params.empresa || '' },
    { key: 'Email do Cliente', val: params.email || '' },
    { key: 'Observação', val: params.obs || '' },
  ]);
  await G.appendRow(sh.title, row);
  return { ok: true };
}

// ── REGISTRO DE HORAS (app de funcionário) ────────────────
async function addLabor(params) {
  const { index } = await G.loadSheetIndex();
  const sh = G.findSheetEntry(index, KW.labor);
  if (!sh) return { error: 'Aba de registro de trabalho não encontrada.' };
  const emp = (params.emp || '').trim();
  if (!emp) return { error: 'Nome do funcionário obrigatório.' };

  const row = G.buildRow(sh.headers, [
    { key: 'Carimbo de data/hora', val: G.nowInTz() },
    { key: 'Nome do funcionário', val: emp },
    { key: 'Endereço da obra', val: params.addr || '' },
    { key: 'Hora de entrada', val: params.entryTime || '' },
    { key: 'Hora de saída', val: params.exitTime || '' },
    { key: 'horas trab', fuzzy: true, val: params.hrs || '' },
    { key: 'Comprou materiais hoje?', val: params.boughtMaterials || 'Não' },
    { key: 'Valor total gasto', val: params.totalSpent ? round2(params.totalSpent) : '' },
    { key: 'Quem pagou?', val: params.whoPaid || '' },
    { key: 'foto', fuzzy: true, val: params.receiptUrl || '' },
    { key: 'material', fuzzy: true, val: params.materialNeeded || '' },
    { key: 'observa', fuzzy: true, val: params.obs || '' },
  ]);
  await G.appendRow(sh.title, row);

  // Aviso por e-mail ao Nilmar quando o funcionário sinaliza material necessário p/ amanhã.
  // Não-fatal: se o e-mail falhar, o registro já foi gravado.
  if (params.materialNeeded && String(params.materialNeeded).trim()) {
    try {
      const to = process.env.NOTIFY_EMAIL || 'tenilmar@icloud.com';
      const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const addr = esc(params.addr);
      const materiais = esc(params.materialNeeded).replace(/\n/g, '<br>');
      const quando = G.nowFriendly();
      const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;max-width:620px">
  <p>Olá, Nilmar.</p>
  <p>🔧 <strong>SOLICITAÇÃO DE MATERIAL PARA PRÓXIMO DIA DE TRABALHO</strong></p>
  <p>Um membro da equipe registrou a necessidade de materiais para a obra de amanhã:</p>
  <p>
    👤 <strong>Funcionário:</strong> ${esc(emp)}<br>
    📍 <strong>Endereço da Obra:</strong> ${addr}<br>
    📦 <strong>Materiais Solicitados:</strong> ${materiais}<br>
    🕐 <strong>Data/Hora da Solicitação:</strong> ${quando}
  </p>
  <p>✅ <strong>Próximos passos sugeridos:</strong></p>
  <ol>
    <li>Verificar estoque para os itens solicitados</li>
    <li>Programar compra ou separação dos materiais</li>
    <li>Confirmar disponibilidade com o funcionário antes do início da obra</li>
  </ol>
  <hr style="border:none;border-top:1px solid #ddd;margin:18px 0">
  <p style="font-size:12px;color:#888;margin:0">
    <em>Este e-mail foi enviado automaticamente pelo sistema de Registro Diário de Trabalho e Despesas da NJR Bathrooms.</em><br>
    <em>Em caso de dúvidas, entre em contato com Felipe (Admin).</em>
  </p>
</div>`;
      await G.sendEmail(to, 'Material necessário amanhã — Nilmar Rebellatto', html, true);
    } catch (_) {}
  }

  return { ok: true };
}

// ── AJUSTES DE PAGAMENTO (bonificação / desconto por funcionário e semana) ──
const AJUSTE_SHEET = 'Ajustes de Pagamento';
const AJUSTE_HEADERS = ['Carimbo de data/hora', 'Nome do funcionário', 'Semana', 'Bonificação', 'Justificativa Bonificação', 'Desconto', 'Justificativa Desconto'];

async function saveAjuste(params) {
  const emp = (params.emp || '').trim();
  const week = (params.week || '').trim();
  if (!emp || !week) return { error: 'Funcionário e semana obrigatórios.' };

  let { index } = await G.loadSheetIndex();
  let sh = index.find(s => s.title === AJUSTE_SHEET);
  if (!sh) {
    await G.createSheet(AJUSTE_SHEET, AJUSTE_HEADERS);
    ({ index } = await G.loadSheetIndex());
    sh = index.find(s => s.title === AJUSTE_SHEET);
  }
  if (!sh) return { error: 'Não foi possível criar a aba "Ajustes de Pagamento".' };

  const headers = sh.headers;
  const nomeIdx = headers.indexOf('Nome do funcionário');
  const semIdx = headers.indexOf('Semana');
  const nomeCol = await G.readColumn(sh.title, nomeIdx);
  const semCol = await G.readColumn(sh.title, semIdx);
  let rowNum = 0;
  for (let i = 1; i < Math.max(nomeCol.length, semCol.length); i++) {
    if (String(nomeCol[i] || '').trim() === emp && String(semCol[i] || '').trim() === week) { rowNum = i + 1; break; }
  }

  const bonif = (params.bonif !== '' && params.bonif != null) ? round2(params.bonif) : 0;
  const desc  = (params.desc !== '' && params.desc != null) ? round2(params.desc) : 0;

  if (rowNum) {
    await G.updateRowCells(sh.title, rowNum, headers, [
      { key: 'Carimbo de data/hora', val: G.nowInTz() },
      { key: 'Bonificação', val: bonif },
      { key: 'Justificativa Bonificação', val: params.justBonif || '' },
      { key: 'Desconto', val: desc },
      { key: 'Justificativa Desconto', val: params.justDesc || '' },
    ]);
  } else {
    const row = G.buildRow(headers, [
      { key: 'Carimbo de data/hora', val: G.nowInTz() },
      { key: 'Nome do funcionário', val: emp },
      { key: 'Semana', val: week, forceText: true },
      { key: 'Bonificação', val: bonif },
      { key: 'Justificativa Bonificação', val: params.justBonif || '' },
      { key: 'Desconto', val: desc },
      { key: 'Justificativa Desconto', val: params.justDesc || '' },
    ]);
    await G.appendRow(sh.title, row);
  }
  return { ok: true };
}

module.exports = {
  addObra, closeObra, updateObra, saveAjuste,
  addMaterial, updateMaterial, deleteMaterial,
  addSubcontrato, updateSubcontrato, deleteSubcontrato,
  addCliente, addLabor,
};
