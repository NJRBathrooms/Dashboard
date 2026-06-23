// ============================================================
// NJR Bathrooms — Google Apps Script Backend
// Publicar como: Execute como "Eu" | Acesso: "Qualquer pessoa"
// ============================================================

const SPREADSHEET_ID = '1D0D1GrvL6Zk2e5qv1cI7cEAHzxTKRLrBjxg3SgCcUzg';
const CACHE_KEY     = 'njr_readAll';
const EMP_CACHE_KEY = 'njr_empData';
const CACHE_TTL = 300; // seconds — readAll result stays cached for 5 minutes (write actions bust it, so dados ficam frescos após gravações)

// doPost handles file uploads (bypasses JSONP limitation for binary data)
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  let result;
  try {
    const action = e.parameter && e.parameter.action;
    if (action === 'uploadFile') {
      result = uploadFileToDrive(e.parameter);
    } else {
      result = { error: 'Ação desconhecida no doPost: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  output.setContent(JSON.stringify(result));
  return output;
}

function doGet(e) {
  const callback = e && e.parameter && e.parameter.callback;
  const action   = e && e.parameter && e.parameter.action;
  const output   = ContentService.createTextOutput();

  let result;
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const cache = CacheService.getScriptCache();

    // Any write action must bust the cache so the next readAll is fresh
    const WRITE_ACTIONS = [
      'addObra','closeObra','updateObra','addMaterial','addSubcontrato',
      'addCliente','deleteMaterial','deleteSubcontrato','updateMaterial','updateSubcontrato',
      'addLabor'
    ];
    if (WRITE_ACTIONS.includes(action)) {
      try { cache.remove(CACHE_KEY); cache.remove(EMP_CACHE_KEY); } catch(_) {}
    }

    if (action === 'addObra') {
      result = addObra(ss, e.parameter);
    } else if (action === 'closeObra') {
      result = closeObra(ss, e.parameter);
    } else if (action === 'updateObra') {
      result = updateObra(ss, e.parameter);
    } else if (action === 'getOrCreateFolder') {
      result = getOrCreateFolder(e.parameter);
    } else if (action === 'addMaterial') {
      result = addMaterial(ss, e.parameter);
    } else if (action === 'addSubcontrato') {
      result = addSubcontrato(ss, e.parameter);
    } else if (action === 'addCliente') {
      result = addCliente(ss, e.parameter);
    } else if (action === 'deleteMaterial') {
      result = deleteMaterial(ss, e.parameter);
    } else if (action === 'deleteSubcontrato') {
      result = deleteSubcontrato(ss, e.parameter);
    } else if (action === 'updateMaterial') {
      result = updateMaterial(ss, e.parameter);
    } else if (action === 'updateSubcontrato') {
      result = updateSubcontrato(ss, e.parameter);
    } else if (action === 'addLabor') {
      result = addLabor(ss, e.parameter);
    } else if (action === 'getEmpCredentials') {
      result = getEmpCredentials(ss);
    } else if (action === 'getEmpData') {
      const empHit = cache.get(EMP_CACHE_KEY);
      if (empHit) {
        result = JSON.parse(empHit);
      } else {
        result = getEmpData(ss);
        try { cache.put(EMP_CACHE_KEY, JSON.stringify(result), CACHE_TTL); } catch(_) {}
      }
    } else {
      // readAll: serve from cache when available, otherwise read sheets and store
      const hit = cache.get(CACHE_KEY);
      if (hit) {
        result = JSON.parse(hit);
      } else {
        result = readAll(ss);
        try { cache.put(CACHE_KEY, JSON.stringify(result), CACHE_TTL); } catch(_) {}
      }
    }
  } catch (err) {
    result = { error: err.message };
  }

  const json = JSON.stringify(result);
  if (callback) {
    output.setMimeType(ContentService.MimeType.JAVASCRIPT);
    output.setContent(callback + '(' + json + ')');
  } else {
    output.setMimeType(ContentService.MimeType.JSON);
    output.setContent(json);
  }
  return output;
}

// ── READ ALL ──────────────────────────────────────────────

function readAll(ss) {
  const sheets        = ss.getSheets();
  const find          = buildSheetFinder(sheets); // lê cabeçalhos uma única vez
  const laborSheet    = find(['Nome do funcionário', 'Hora de entrada']);
  const matsSheet     = find(['Data da Compra', 'Descrição dos Itens']);
  const subsSheet     = find(['Empresa Subcontratada', 'Valor do serviço']);
  const obrasSheet    = find(['Nome do Cliente', 'Orçamento']);
  const clientesSheet = find(['Contato do Cliente', 'Email do Cliente']);

  return {
    labor:          laborSheet    ? getSheetData(laborSheet)    : [],
    materials:      matsSheet     ? getSheetData(matsSheet)     : [],
    subcontractors: subsSheet     ? getSheetData(subsSheet, 11) : [],
    obras:          obrasSheet    ? getSheetData(obrasSheet)    : [],
    clients:        clientesSheet ? getSheetData(clientesSheet) : [],
    lastUpdated:    new Date().toISOString()
  };
}

// ── OBRAS WRITE ACTIONS ───────────────────────────────────

function addObra(ss, params) {
  const sheet = getObrasSheet(ss);
  if (!sheet) return { error: 'Aba "Cadastro de Obras" não encontrada. Crie a aba com os cabeçalhos corretos.' };

  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };

  // Duplicate check
  const existing = getSheetData(sheet);
  if (existing.some(r => normStr(r['Endereço']) === normStr(addr))) {
    return { error: 'Já existe uma obra cadastrada para esse endereço.' };
  }

  sheet.appendRow([
    addr,
    params.cliente     || '',
    params.contato     || '',
    params.escopo      || '',
    params.orcamento   ? parseFloat(params.orcamento) : '',
    params.dtInicio    || '',
    params.dtFim       || '',
    params.fotosBefore || '',
    'Não',
    ''
  ]);
  // Force text format on contato cell to prevent "+" from being interpreted as formula
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 3).setNumberFormat('@').setValue(String(params.contato || ''));
  return { ok: true };
}

function closeObra(ss, params) {
  const sheet = getObrasSheet(ss);
  if (!sheet) return { error: 'Aba "Cadastro de Obras" não encontrada.' };

  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };

  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Find address column by header name — do NOT assume column 1
  let addrColIdx = headers.findIndex(h => normStr(h).includes('endere'));
  if (addrColIdx < 0) addrColIdx = 0;

  // Try to find existing row for this address
  if (lastRow >= 2) {
    const addrColData = sheet.getRange(1, addrColIdx + 1, lastRow, 1).getValues();
    for (let i = 1; i < addrColData.length; i++) {
      if (normStr(addrColData[i][0]) === normStr(addr)) {
        const rowNum = i + 1;
        const set = (hdr, val) => {
          const c = headers.indexOf(hdr);
          if (c >= 0) sheet.getRange(rowNum, c + 1).setValue(val);
        };
        set('Finalizada',       'Sim');
        set('Data Finalização', params.dtFinal || '');
        if (params.fotosAfter) {
          let fotosCol = headers.indexOf('Link Fotos Depois');
          if (fotosCol < 0) {
            fotosCol = sheet.getLastColumn();
            sheet.getRange(1, fotosCol + 1).setValue('Link Fotos Depois');
          }
          sheet.getRange(rowNum, fotosCol + 1).setValue(params.fotosAfter);
        }
        return { ok: true };
      }
    }
  }

  // Obra not found — was registered only via materials/labor/subcontracts (before the
  // "Incluir nova obra" form existed). Create a minimal row and mark it as finalized.
  const row = new Array(headers.length).fill('');
  row[addrColIdx] = addr;
  const markCol = (hdr, val) => { const c = headers.indexOf(hdr); if (c >= 0) row[c] = val; };
  markCol('Finalizada',       'Sim');
  markCol('Data Finalização', params.dtFinal || '');
  if (params.fotosAfter && headers.indexOf('Link Fotos Depois') >= 0) {
    markCol('Link Fotos Depois', params.fotosAfter);
  }
  sheet.appendRow(row);
  // If 'Link Fotos Depois' column doesn't exist yet, create it on the new row
  if (params.fotosAfter && headers.indexOf('Link Fotos Depois') < 0) {
    const newCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, newCol).setValue('Link Fotos Depois');
    sheet.getRange(sheet.getLastRow(), newCol).setValue(params.fotosAfter);
  }
  return { ok: true, created: true };
}

function updateObra(ss, params) {
  const sheet = getObrasSheet(ss);
  if (!sheet) return { error: 'Aba "Cadastro de Obras" não encontrada.' };

  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { error: 'Nenhuma obra cadastrada.' };

  const headers    = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let addrColIdx   = headers.findIndex(h => normStr(h).includes('endere'));
  if (addrColIdx < 0) addrColIdx = 0;
  const col1       = sheet.getRange(1, addrColIdx + 1, lastRow, 1).getValues();
  const fieldMap   = {
    cliente:    'Nome do Cliente',
    contato:    'Contato',
    escopo:     'Escopo',
    orcamento:  'Orçamento',
    dtInicio:   'Data Início Prevista',
    dtFim:      'Data Fim Prevista',
    fotosBefore:'Link Fotos Antes',
    finalizada: 'Finalizada',
    dtFinal:    'Data Finalização',
    fotosAfter: 'Link Fotos Depois'
  };

  for (let i = 1; i < col1.length; i++) {
    if (normStr(col1[i][0]) === normStr(addr)) {
      Object.entries(fieldMap).forEach(([pk, hdr]) => {
        if (params[pk] !== undefined) {
          const col = headers.indexOf(hdr);
          if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(params[pk]);
        }
      });
      return { ok: true };
    }
  }
  return { error: 'Obra não encontrada para esse endereço.' };
}

// ── MATERIAIS WRITE ───────────────────────────────────────

function addMaterial(ss, params) {
  const sheet = findSheet(ss.getSheets(), ['Data da Compra', 'Descrição dos Itens']);
  if (!sheet) return { error: 'Aba de materiais não encontrada. Verifique se existe uma aba com as colunas "Data da Compra" e "Descrição dos Itens".' };

  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = new Array(headers.length).fill('');

  const set = function(h, v) {
    const i = headers.indexOf(h);
    if (i >= 0) row[i] = v;
  };
  const setFuzzy = function(term, v) {
    const i = headers.findIndex(function(h) { return h.toLowerCase().includes(term.toLowerCase()); });
    if (i >= 0) row[i] = v;
  };

  set('Carimbo de data/hora', new Date());
  set('Data da Compra', params.dataCom || '');
  set('Endereço da obra', addr);
  set('É um custo extra para o cliente pagar?', params.isExtra || 'Não');
  set('Descrição dos Itens', params.desc || '');
  set('Valor Total Pago ($)', params.amount ? Math.round(parseFloat(params.amount) * 100) / 100 : '');
  set('Anexar Comprovante/NF', params.comprovante || '');
  setFuzzy('Observa', params.obs || '');
  set('Selecione a empresa', params.empresa || '');

  sheet.appendRow(row);
  return { ok: true };
}

// ── SUBCONTRATOS WRITE ────────────────────────────────────

function addSubcontrato(ss, params) {
  const sheet = findSheet(ss.getSheets(), ['Empresa Subcontratada', 'Valor do serviço']);
  if (!sheet) return { error: 'Aba de subcontratos não encontrada. Verifique se existe uma aba com as colunas "Empresa Subcontratada" e "Valor do serviço".' };

  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = new Array(headers.length).fill('');

  const set = function(h, v) {
    const i = headers.indexOf(h);
    if (i >= 0) row[i] = v;
  };
  const setFuzzy = function(term, v) {
    const i = headers.findIndex(function(h) { return h.toLowerCase().includes(term.toLowerCase()); });
    if (i >= 0) row[i] = v;
  };

  set('Carimbo de data/hora', new Date());
  set('Endereço da obra', addr);
  setFuzzy('Data de conclus', params.dataCon || '');
  set('Tipo de serviço', params.tipo || '');
  set('Descrição do serviço', params.desc || '');
  set('Empresa Subcontratada', params.empresa || '');
  set('Contato do Subcontratado', ''); // set via setNumberFormat below to avoid "+" being parsed as formula
  set('Valor do serviço', params.amount ? Math.round(parseFloat(params.amount) * 100) / 100 : '');
  set('Status pagamento', params.status || '');
  setFuzzy('invoice', params.invoice || '');

  sheet.appendRow(row);
  // Force text format on contato cell to prevent "+" from being interpreted as formula
  const lastRow = sheet.getLastRow();
  const contatoIdx = headers.indexOf('Contato do Subcontratado');
  if (contatoIdx >= 0) {
    sheet.getRange(lastRow, contatoIdx + 1).setNumberFormat('@').setValue(String(params.contato || ''));
  }
  return { ok: true };
}

// ── MATERIAIS / SUBCONTRATOS EDIT & DELETE ───────────────

function deleteMaterial(ss, params) {
  const sheet = findSheet(ss.getSheets(), ['Data da Compra', 'Descrição dos Itens']);
  if (!sheet) return { error: 'Aba de materiais não encontrada.' };
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Número de linha inválido.' };
  sheet.deleteRow(rowNum);
  return { ok: true };
}

function deleteSubcontrato(ss, params) {
  const sheet = findSheet(ss.getSheets(), ['Empresa Subcontratada', 'Valor do serviço']);
  if (!sheet) return { error: 'Aba de subcontratos não encontrada.' };
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Número de linha inválido.' };
  sheet.deleteRow(rowNum);
  return { ok: true };
}

function updateMaterial(ss, params) {
  const sheet = findSheet(ss.getSheets(), ['Data da Compra', 'Descrição dos Itens']);
  if (!sheet) return { error: 'Aba de materiais não encontrada.' };
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Número de linha inválido.' };
  const headers = getHeaders(sheet);
  const set = (h, v) => { const i=headers.indexOf(h); if(i>=0&&v!==undefined) sheet.getRange(rowNum,i+1).setValue(v); };
  const setFuzzy = (term, v) => { const i=headers.findIndex(h=>h.toLowerCase().includes(term.toLowerCase())); if(i>=0&&v!==undefined) sheet.getRange(rowNum,i+1).setValue(v); };
  if (params.dataCom) set('Data da Compra', params.dataCom); // only overwrite if non-empty
  if (params.desc    !== undefined) set('Descrição dos Itens', params.desc);
  if (params.amount  !== undefined) set('Valor Total Pago ($)', params.amount ? Math.round(parseFloat(params.amount)*100)/100 : '');
  if (params.isExtra !== undefined) set('É um custo extra para o cliente pagar?', params.isExtra);
  if (params.empresa !== undefined) set('Selecione a empresa', params.empresa);
  if (params.obs     !== undefined) setFuzzy('Observa', params.obs);
  return { ok: true };
}

function updateSubcontrato(ss, params) {
  const sheet = findSheet(ss.getSheets(), ['Empresa Subcontratada', 'Valor do serviço']);
  if (!sheet) return { error: 'Aba de subcontratos não encontrada.' };
  const rowNum = parseInt(params.rowNum);
  if (!rowNum || rowNum < 2) return { error: 'Número de linha inválido.' };
  const headers = getHeaders(sheet);
  const set = (h, v) => { const i=headers.indexOf(h); if(i>=0&&v!==undefined) sheet.getRange(rowNum,i+1).setValue(v); };
  const setFuzzy = (term, v) => { const i=headers.findIndex(h=>h.toLowerCase().includes(term.toLowerCase())); if(i>=0&&v!==undefined) sheet.getRange(rowNum,i+1).setValue(v); };
  if (params.dataCon) setFuzzy('Data de conclus', params.dataCon); // only overwrite if non-empty
  if (params.tipo    !== undefined) set('Tipo de serviço', params.tipo);
  if (params.desc    !== undefined) set('Descrição do serviço', params.desc);
  if (params.empresa !== undefined) set('Empresa Subcontratada', params.empresa);
  if (params.contato !== undefined) set('Contato do Subcontratado', params.contato);
  if (params.amount  !== undefined) set('Valor do serviço', params.amount ? Math.round(parseFloat(params.amount)*100)/100 : '');
  if (params.status  !== undefined) set('Status pagamento', params.status);
  return { ok: true };
}

// ── CLIENTES WRITE ────────────────────────────────────────

function addCliente(ss, params) {
  let sheet = getClientesSheet(ss);

  // Auto-create the sheet with headers if it doesn't exist yet
  if (!sheet) {
    sheet = ss.insertSheet('Cadastro de Clientes');
    sheet.appendRow([
      'Carimbo de data/hora',
      'Nome do Cliente',
      'Contato do Cliente',
      'Empresa do Cliente',
      'Email do Cliente',
      'Observação'
    ]);
  }

  const nome = (params.nome || '').trim();
  if (!nome) return { error: 'Nome do cliente é obrigatório.' };

  const contato = (params.contato || '').trim();
  if (!contato) return { error: 'Contato do cliente é obrigatório.' };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = new Array(headers.length).fill('');
  const set = function(h, v) { const i=headers.indexOf(h); if(i>=0) row[i]=v; };

  set('Carimbo de data/hora', new Date());
  set('Nome do Cliente',      nome);
  set('Contato do Cliente',   contato);
  set('Empresa do Cliente',   params.empresa || '');
  set('Email do Cliente',     params.email   || '');
  set('Observação',           params.obs     || '');

  sheet.appendRow(row);
  // Force text format on contato cell to prevent "+" from being treated as formula
  const lastRow = sheet.getLastRow();
  const contatoIdx = headers.indexOf('Contato do Cliente');
  if (contatoIdx >= 0) {
    sheet.getRange(lastRow, contatoIdx + 1).setNumberFormat('@').setValue(String(contato));
  }
  return { ok: true };
}

// ── GOOGLE DRIVE FOLDER ───────────────────────────────────

function getOrCreateFolder(params) {
  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };
  const subfolder = params.subfolder || 'Antes';

  // Sanitize folder name for Drive
  const safe     = addr.replace(/[\/\\:*?"<>|]/g, '-').substring(0, 100);
  const obraName = 'NJR - ' + safe;
  const rootName = 'NJR Bathrooms - Fotos';

  const rootIt = DriveApp.getFoldersByName(rootName);
  const root   = rootIt.hasNext() ? rootIt.next() : DriveApp.createFolder(rootName);

  const obraIt  = root.getFoldersByName(obraName);
  const obraDir = obraIt.hasNext() ? obraIt.next() : root.createFolder(obraName);

  const subIt = obraDir.getFoldersByName(subfolder);
  const sub   = subIt.hasNext() ? subIt.next() : obraDir.createFolder(subfolder);

  // Share once at the folder level so files created inside inherit view access
  // (avoids one extra Drive API call per file upload)
  sub.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return { ok: true, url: sub.getUrl(), id: sub.getId() };
}

// ── FILE UPLOAD (called via doPost) ──────────────────────────

function uploadFileToDrive(params) {
  const folderId  = (params.folderId   || '').trim();
  const fileBase64 = (params.fileBase64 || '').trim();
  const fileName  = (params.fileName   || 'foto.jpg').trim();
  const mimeType  = (params.mimeType   || 'image/jpeg').trim();

  if (!folderId)   return { error: 'ID da pasta é obrigatório.' };
  if (!fileBase64) return { error: 'Dados da imagem são obrigatórios.' };

  try {
    const folder = DriveApp.getFolderById(folderId);
    const bytes  = Utilities.base64Decode(fileBase64);
    const blob   = Utilities.newBlob(bytes, mimeType, fileName);
    const file   = folder.createFile(blob);
    // No per-file setSharing call — the parent folder is already shared (see getOrCreateFolder)
    return { ok: true, fileUrl: file.getUrl(), fileId: file.getId(), name: fileName };
  } catch (err) {
    return { error: 'Erro ao fazer upload: ' + err.message };
  }
}

// ── HELPERS ───────────────────────────────────────────────

function getObrasSheet(ss) {
  return findSheet(ss.getSheets(), ['Nome do Cliente', 'Orçamento']);
}
function getClientesSheet(ss) {
  return findSheet(ss.getSheets(), ['Contato do Cliente', 'Email do Cliente']);
}

function normStr(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findSheet(sheets, keywords) {
  for (const sheet of sheets) {
    const headers = getHeaders(sheet);
    if (keywords.every(kw => headers.some(h => h.toLowerCase().includes(kw.toLowerCase())))) return sheet;
  }
  return null;
}

// Lê o cabeçalho de cada aba UMA única vez e devolve um matcher reutilizável.
// Evita o custo do findSheet(), que relê os cabeçalhos de todas as abas a cada busca
// (em readAll eram até 5×N leituras de cabeçalho — agora são apenas N).
function buildSheetFinder(sheets) {
  const cache = sheets.map(function(sh) { return { sheet: sh, headers: getHeaders(sh) }; });
  return function(keywords) {
    const lowered = keywords.map(function(k) { return k.toLowerCase(); });
    const hit = cache.find(function(hc) {
      return lowered.every(function(kw) {
        return hc.headers.some(function(h) { return h.toLowerCase().includes(kw); });
      });
    });
    return hit ? hit.sheet : null;
  };
}

function getHeaders(sheet, maxCols) {
  const lastCol = maxCols
    ? Math.min(sheet.getLastColumn(), maxCols)
    : sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
}

// ── EMPLOYEE APP ─────────────────────────────────────────────

function getEmpData(ss) {
  const sheets     = ss.getSheets();
  const find       = buildSheetFinder(sheets); // lê cabeçalhos uma única vez
  const laborSheet = find(['Nome do funcionário', 'Hora de entrada']);
  const obrasSheet = find(['Nome do Cliente', 'Orçamento']);
  return {
    labor:       laborSheet ? getSheetData(laborSheet) : [],
    obras:       obrasSheet ? getSheetData(obrasSheet) : [],
    lastUpdated: new Date().toISOString()
  };
}

function getEmpCredentials(ss) {
  const sheet = findSheet(ss.getSheets(), ['Nome', 'Senha']);
  if (!sheet) return { credentials: [] };
  const data = getSheetData(sheet);
  const credentials = data.map(r => ({ nome: String(r['Nome'] || '').trim(), senha: String(r['Senha'] || '').trim() }))
                          .filter(c => c.nome && c.senha);
  return { credentials };
}

function addLabor(ss, params) {
  const sheet = findSheet(ss.getSheets(), ['Nome do funcionário', 'Hora de entrada']);
  if (!sheet) return { error: 'Aba de registro de trabalho não encontrada.' };

  const emp = (params.emp || '').trim();
  if (!emp) return { error: 'Nome do funcionário obrigatório.' };

  const headers = getHeaders(sheet);
  const row = new Array(headers.length).fill('');

  const set = function(h, v) { const i = headers.indexOf(h); if (i >= 0) row[i] = v; };
  const setFuzzy = function(term, v) {
    const i = headers.findIndex(function(h) { return h.toLowerCase().includes(term.toLowerCase()); });
    if (i >= 0) row[i] = v;
  };

  set('Carimbo de data/hora',           new Date());
  set('Nome do funcionário',             emp);
  set('Endereço da obra',                params.addr || '');
  set('Hora de entrada',                 params.entryTime || '');
  set('Hora de saída',                   params.exitTime || '');
  setFuzzy('horas trab',                 params.hrs || '');
  set('Comprou materiais hoje?',         params.boughtMaterials || 'Não');
  set('Valor total gasto',               params.totalSpent ? (Math.round(parseFloat(params.totalSpent) * 100) / 100) : '');
  set('Quem pagou?',                     params.whoPaid || '');
  setFuzzy('foto',                       params.receiptUrl || '');
  setFuzzy('material',                   params.materialNeeded || '');
  setFuzzy('observa',                    params.obs || '');

  sheet.appendRow(row);

  // Send email alert to owner if employee flagged needed materials
  if (params.materialNeeded && String(params.materialNeeded).trim()) {
    try {
      const ownerEmail = Session.getEffectiveUser().getEmail();
      MailApp.sendEmail(
        ownerEmail,
        'Material necessário amanhã — ' + emp,
        emp + ' reportou que precisa de material para amanhã na obra ' +
        (params.addr || '') + ':\n\n' + params.materialNeeded
      );
    } catch(e) {
      // Non-fatal: log but don't fail the record insertion
      Logger.log('Email send error: ' + e.message);
    }
  }

  return { ok: true };
}

// ── DATABASE BACKUP ────────────────────────────────────────

function backupDatabase() {
  const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  const file   = DriveApp.getFileById(ss.getId());
  const tz     = Session.getScriptTimeZone();
  const today  = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const name   = 'NJR Bathrooms - Backup ' + today;
  const rootIt = DriveApp.getFoldersByName('NJR Bathrooms - Backups');
  const folder = rootIt.hasNext() ? rootIt.next() : DriveApp.createFolder('NJR Bathrooms - Backups');
  const copy   = file.makeCopy(name, folder);
  return { ok: true, name: copy.getName(), url: copy.getUrl() };
}

// Run once from the Apps Script editor to register the weekly trigger.
// After that, Google runs backupDatabase() automatically every Monday at 10am.
function setupWeeklyBackupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'backupDatabase')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('backupDatabase')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(10)
    .create();
  return { ok: true, message: 'Trigger configurado: toda segunda-feira às 10h.' };
}

function getSheetData(sheet, maxCols) {
  const lastRow = sheet.getLastRow();
  const lastCol = maxCols
    ? Math.min(sheet.getLastColumn(), maxCols)
    : sheet.getLastColumn();

  if (lastRow < 2 || lastCol < 1) return [];

  const values   = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers  = values[0].map(h => String(h).trim());
  const timezone = Session.getScriptTimeZone();

  // Map before filter so _row reflects the actual spreadsheet row number
  return values
    .slice(1)
    .map((row, idx) => {
      const obj = { _row: idx + 2 }; // idx=0 → row 2 (row 1 is header)
      headers.forEach((h, i) => {
        if (!h) return;
        let val = row[i];
        if (val instanceof Date) {
          const yr = val.getFullYear();
          if (yr <= 1900) {
            val = Utilities.formatDate(val, timezone, 'HH:mm:ss');
          } else {
            val = Utilities.formatDate(val, timezone, 'yyyy/MM/dd HH:mm:ss');
          }
        }
        if (!(h in obj)) {
          obj[h] = val;
        } else if ((obj[h] === '' || obj[h] === null || obj[h] === undefined) &&
                   val !== '' && val !== null && val !== undefined) {
          obj[h] = val;
        }
      });
      return obj;
    })
    .filter(obj => Object.keys(obj).some(k => k !== '_row' && obj[k] !== '' && obj[k] !== null && obj[k] !== undefined));
}
