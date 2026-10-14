// ============================================================
// CRM — fichas de cliente, vínculo obra ↔ cliente e correção de dados.
// Design: docs/2026-10-14-crm-design.md
//
// Helper (prefixo _): NÃO conta como função serverless. As ações entram no
// write.js — o projeto está no teto de 12 funções do plano Hobby da Vercel.
// ============================================================

const G = require('./_google');

const KW_OBRAS = ['nome do cliente', 'orçamento'];
const KW_CLIENTES = ['contato do cliente', 'email do cliente'];

const COLS_CLIENTE = ['ID Cliente', 'Tipo', 'Canal Preferido', 'Origem', 'Não Contatar'];
const COLS_OBRA = ['ID Cliente', 'Morador Nome', 'Morador Telefone', 'Autorizado Em', 'Conclusão Conferida'];
const TIPOS = ['Empreiteiro', 'Cliente'];

// ── utilitários puros ─────────────────────────────────────

const t = v => String(v == null ? '' : v).trim();
const norm = s => t(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// identidade pelo telefone: os 10 últimos dígitos (tira o +1 e a formatação)
const foneDe = s => { const n = t(s).replace(/\D/g, ''); return n.length >= 10 ? n.slice(-10) : ''; };
const fmtFone = f => (f ? '(' + f.slice(0, 3) + ') ' + f.slice(3, 6) + '-' + f.slice(6) : '');

// Preenchimento que não é nome de cliente — essas obras ficam "a identificar".
const LIXO = new Set(['nao sei', '6s']);
const nomeValido = nome => { const n = norm(nome); return !!n && !LIXO.has(n); };

// Endereço sem o sufixo de fase: "174 Weirs Rd - tile" e "174 Weirs Rd" são a mesma casa.
const baseAddr = s => norm(t(s).replace(/\s*[-–]\s*(fase.*|drywall.*|tile.*)$/i, ''));

// Palavras que indicam empresa no nome. Só serve para o PALPITE do tipo — o
// Nilmar confirma ficha por ficha.
const PALAVRAS_EMPRESA = new Set(['builders', 'builder', 'built', 'builtwell', 'painting', 'design',
  'cabinet', 'cabinets', 'homes', 'renovations', 'renovation', 'construction', 'remodel',
  'remodeling', 'contractor', 'contracting', 'llc', 'inc', 'pros', 'plumbing', 'electric']);

function tipoSugerido({ empresa, enderecosDistintos, nomes }) {
  if (t(empresa)) return 'Empreiteiro';
  if (enderecosDistintos >= 2) return 'Empreiteiro';
  const toks = new Set((nomes || []).flatMap(n => norm(n).split(' ')));
  for (const p of PALAVRAS_EMPRESA) if (toks.has(p)) return 'Empreiteiro';
  return 'Cliente';
}

// Grafia mais usada, contando SEM diferenciar maiúsculas: "Cris Bouchard" e
// "Cris bouchard" somam 2 contra 1 de "Cris boulchard". Contar com caixa deixava
// as três empatadas, e o desempate escolhia o erro de digitação.
// Dentro da grafia vencedora, prefere a com mais palavras capitalizadas.
function nomeCanonico(nomes) {
  const grupos = {};
  nomes.forEach(n => {
    const v = t(n); if (!v) return;
    const k = norm(v);
    (grupos[k] = grupos[k] || []).push(v);
  });
  const k = Object.keys(grupos).sort((a, b) => grupos[b].length - grupos[a].length || b.length - a.length)[0];
  if (!k) return '';
  const caps = s => s.split(/\s+/).filter(w => /^[A-Z]/.test(w)).length;
  return grupos[k].slice().sort((a, b) => caps(b) - caps(a) || b.length - a.length)[0];
}

const ID_RE = /^C(\d+)$/;
// Devolve uma função que entrega o próximo ID livre a cada chamada.
function geradorIds(idsExistentes) {
  let max = 0;
  (idsExistentes || []).forEach(id => { const m = ID_RE.exec(t(id)); if (m) max = Math.max(max, +m[1]); });
  return () => 'C' + String(++max).padStart(3, '0');
}

// ── montagem das fichas (pura: recebe linhas, devolve o plano) ──
//
// Regras:
//   - a identidade é o TELEFONE; o nome é só reserva para obra sem telefone;
//   - obras COM telefone são processadas primeiro, para que uma obra sem telefone
//     encontre o grupo certo pelo nome;
//   - nome usado por dois telefones diferentes é ambíguo → não serve de ponte;
//   - SÓ preenche o que está vazio. Obra já vinculada e ficha já com ID não mudam.
function planejarFichas(clientes, obras) {
  const gerar = geradorIds((clientes || []).map(c => c['ID Cliente']));
  const fichas = [];
  const porFone = new Map();
  const porNome = new Map();   // norm(nome) -> Set(fichas)
  const porId = new Map();

  const registrarNome = (ficha, nome) => {
    const n = norm(nome); if (!n) return;
    if (!porNome.has(n)) porNome.set(n, new Set());
    porNome.get(n).add(ficha);
  };

  (clientes || []).forEach(c => {
    if (!nomeValido(c['Nome do Cliente'])) return;
    const f = {
      existente: true, row: c._row, id: t(c['ID Cliente']),
      nome: t(c['Nome do Cliente']), fone: foneDe(c['Contato do Cliente']),
      empresa: t(c['Empresa do Cliente']), tipo: t(c['Tipo']), origem: t(c['Origem']),
      obras: [], nomes: [t(c['Nome do Cliente'])],
    };
    fichas.push(f);
    if (f.fone && !porFone.has(f.fone)) porFone.set(f.fone, f);
    if (f.id) porId.set(f.id, f);
    registrarNome(f, f.nome);
  });

  const aIdentificar = [];
  const vincular = (f, o) => { f.obras.push(o); f.nomes.push(t(o['Nome do Cliente'])); registrarNome(f, o['Nome do Cliente']); };
  const nova = fone => {
    const f = { existente: false, row: null, id: '', nome: '', fone, empresa: '', tipo: '', origem: '', obras: [], nomes: [] };
    fichas.push(f);
    if (fone) porFone.set(fone, f);
    return f;
  };

  const lista = (obras || []).filter(o => t(o['Endereço']));
  // obra já vinculada: entra na ficha dela (conta para o palpite de tipo), sem mudar nada
  const livres = [];
  lista.forEach(o => {
    const id = t(o['ID Cliente']);
    if (id && porId.has(id)) porId.get(id).obras.push(o);
    else if (!id) livres.push(o);
  });

  const comFone = livres.filter(o => nomeValido(o['Nome do Cliente']) && foneDe(o['Contato']));
  const semFone = livres.filter(o => nomeValido(o['Nome do Cliente']) && !foneDe(o['Contato']));
  livres.filter(o => !nomeValido(o['Nome do Cliente'])).forEach(o => aIdentificar.push(o));

  comFone.forEach(o => {
    const fone = foneDe(o['Contato']);
    vincular(porFone.get(fone) || nova(fone), o);
  });
  semFone.forEach(o => {
    const candidatas = porNome.get(norm(o['Nome do Cliente']));
    const f = candidatas && candidatas.size === 1 ? [...candidatas][0] : null;
    if (f) { vincular(f, o); return; }
    const g = nova('');
    vincular(g, o);
  });

  const novas = [], atualizarClientes = [], atualizarObras = [];
  fichas.forEach(f => {
    const enderecosDistintos = new Set(f.obras.map(o => baseAddr(o['Endereço']))).size;
    const tipo = f.tipo || tipoSugerido({ empresa: f.empresa, enderecosDistintos, nomes: f.nomes });
    const origem = f.origem || (f.fone ? 'Confirmado' : 'Inferido');
    if (!f.existente) {
      f.id = gerar();
      f.nome = nomeCanonico(f.nomes);
      novas.push({ id: f.id, nome: f.nome, telefone: fmtFone(f.fone), tipo, origem });
    } else {
      const ups = [];
      if (!f.id) { f.id = gerar(); ups.push({ key: 'ID Cliente', val: f.id }); }
      if (!f.tipo) ups.push({ key: 'Tipo', val: tipo });
      if (!f.origem) ups.push({ key: 'Origem', val: origem });
      if (ups.length) atualizarClientes.push({ rowNum: f.row, updates: ups });
    }
    f.tipoFinal = tipo;
    f.obras.forEach(o => {
      if (!t(o['ID Cliente'])) atualizarObras.push({ rowNum: o._row, updates: [{ key: 'ID Cliente', val: f.id }] });
    });
  });

  const comObras = fichas.filter(f => f.obras.length);
  return {
    novas, atualizarClientes, atualizarObras,
    resumo: {
      fichasNovas: novas.length,
      fichasAtualizadas: atualizarClientes.length,
      obrasVinculadas: atualizarObras.length,
      recorrentes: comObras.filter(f => f.obras.length > 1).length,
      deUmaObra: comObras.filter(f => f.obras.length === 1).length,
      aIdentificar: aIdentificar.length,
      empreiteiros: comObras.filter(f => f.tipoFinal === 'Empreiteiro').length,
      clientes: comObras.filter(f => f.tipoFinal === 'Cliente').length,
      fichas: comObras.map(f => ({ id: f.id, nome: f.existente ? f.nome : nomeCanonico(f.nomes),
        obras: f.obras.length, tipo: f.tipoFinal, origem: f.origem || (f.fone ? 'Confirmado' : 'Inferido') })),
    },
  };
}

// ── acesso à planilha ─────────────────────────────────────

// Acrescenta as colunas que faltam numa chamada só, no fim do cabeçalho.
// Nunca reordena nem apaga coluna existente.
async function garantirColunas(sh, nomes) {
  const faltam = nomes.filter(n => !sh.headers.includes(n));
  if (!faltam.length) return 0;
  const novos = sh.headers.concat(faltam);
  await G.batchUpdateRows(sh.title, novos, [{ rowNum: 1, updates: faltam.map(n => ({ key: n, val: n })) }]);
  sh.headers = novos;
  return faltam.length;
}

async function abasCrm() {
  const { index } = await G.loadSheetIndex();
  const shC = G.findSheetEntry(index, KW_CLIENTES);
  const shO = G.findSheetEntry(index, KW_OBRAS);
  if (!shC) throw new Error('Aba "Cadastro de Clientes" não encontrada.');
  if (!shO) throw new Error('Aba "Cadastro de Obras" não encontrada.');
  await garantirColunas(shC, COLS_CLIENTE);
  await garantirColunas(shO, COLS_OBRA);
  return { shC, shO, index };
}

async function lerLinhas(sh) {
  const { byTitle } = await G.readWorkbook();
  return G.rowsToObjects(byTitle[sh.title] || []);
}

const colEndereco = headers => {
  const i = headers.findIndex(h => G.normStr(h).includes('endere'));
  return i < 0 ? 0 : i;
};

// linha (1-based) da obra pelo endereço
async function linhaDaObra(shO, addr) {
  const col = await G.readColumn(shO.title, colEndereco(shO.headers));
  const alvo = G.normStr(addr);
  for (let i = 1; i < col.length; i++) if (G.normStr(col[i]) === alvo) return i + 1;
  return 0;
}

// linha (1-based) da ficha pelo ID
async function linhaDoCliente(shC, id) {
  const col = await G.readColumn(shC.title, shC.headers.indexOf('ID Cliente'));
  for (let i = 1; i < col.length; i++) if (t(col[i]) === t(id)) return i + 1;
  return 0;
}

// Cria uma ficha. Usada pelo CRM e pelos formulários de obra/cliente, para
// que toda ficha nasça com ID, tipo e origem.
async function criarFicha(shC, { nome, telefone, empresa, email, obs, tipo, origem }) {
  const ids = await G.readColumn(shC.title, shC.headers.indexOf('ID Cliente'));
  const id = geradorIds(ids.slice(1))();
  const row = G.buildRow(shC.headers, [
    { key: 'Carimbo de data/hora', val: G.nowInTz() },
    { key: 'Nome do Cliente', val: t(nome) },
    { key: 'Contato do Cliente', val: t(telefone), forceText: true },
    { key: 'Empresa do Cliente', val: t(empresa) },
    { key: 'Email do Cliente', val: t(email) },
    { key: 'Observação', val: t(obs) },
    { key: 'ID Cliente', val: id },
    { key: 'Tipo', val: tipo },
    { key: 'Origem', val: origem || 'Nilmar' },
  ]);
  await G.appendRow(shC.title, row);
  return id;
}

// Rede de segurança do formulário de obra: se já existe ficha com o mesmo nome
// (ignorando maiúscula/acento), usa ela em vez de criar uma duplicata.
async function fichaPorNomeOuCriar(shC, dados) {
  const nomes = await G.readColumn(shC.title, shC.headers.indexOf('Nome do Cliente'));
  const ids = await G.readColumn(shC.title, shC.headers.indexOf('ID Cliente'));
  for (let i = 1; i < nomes.length; i++) {
    if (norm(nomes[i]) && norm(nomes[i]) === norm(dados.nome) && t(ids[i])) return t(ids[i]);
  }
  const fone = foneDe(dados.telefone);
  return criarFicha(shC, { ...dados, telefone: fone ? fmtFone(fone) : t(dados.telefone), origem: 'Nilmar' });
}

// ── ações ─────────────────────────────────────────────────

// Montagem inicial das fichas. Idempotente: rodar de novo não duplica nada.
// { simular: true } devolve o plano sem escrever — usado para conferir antes.
async function crmPreparar(params = {}) {
  const { shC, shO } = await abasCrm();
  const { byTitle } = await G.readWorkbook();
  const clientes = G.rowsToObjects(byTitle[shC.title] || []);
  const obras = G.rowsToObjects(byTitle[shO.title] || []);
  const plano = planejarFichas(clientes, obras);
  if (params.simular) return { ok: true, simulado: true, resumo: plano.resumo };

  if (plano.novas.length) {
    const ts = G.nowInTz();
    await G.appendRows(shC.title, plano.novas.map(f => G.buildRow(shC.headers, [
      { key: 'Carimbo de data/hora', val: ts },
      { key: 'Nome do Cliente', val: f.nome },
      { key: 'Contato do Cliente', val: f.telefone, forceText: true },
      { key: 'ID Cliente', val: f.id },
      { key: 'Tipo', val: f.tipo },
      { key: 'Origem', val: f.origem },
    ])));
  }
  await G.batchUpdateRows(shC.title, shC.headers, plano.atualizarClientes);
  await G.batchUpdateRows(shO.title, shO.headers, plano.atualizarObras);
  return { ok: true, resumo: plano.resumo };
}

const validaTipo = tipo => TIPOS.includes(t(tipo));

// Cria ou edita a ficha. Toda edição feita aqui é do Nilmar → Origem = Nilmar.
// Renomear propaga o nome para as obras vinculadas, para o resto do app ficar
// consistente (era a grafia divergente que sujava a base).
async function crmSalvarCliente(params) {
  const nome = t(params.nome);
  if (!nome) return { error: 'Nome do cliente é obrigatório.' };
  if (!validaTipo(params.tipo)) return { error: 'Escolha se é Empreiteiro ou Cliente.' };
  const { shC, shO } = await abasCrm();
  const fone = t(params.telefone);
  if (fone && !foneDe(fone)) return { error: 'Telefone inválido — informe os 10 dígitos com DDD.' };
  const telefone = fone ? fmtFone(foneDe(fone)) : '';

  const nomes = await G.readColumn(shC.title, shC.headers.indexOf('Nome do Cliente'));
  const ids = await G.readColumn(shC.title, shC.headers.indexOf('ID Cliente'));
  const id = t(params.id);

  // mesmo nome em outra ficha = provável duplicata; quem resolve é o "Juntar"
  for (let i = 1; i < nomes.length; i++) {
    if (norm(nomes[i]) === norm(nome) && t(ids[i]) !== id) {
      return { error: 'Já existe outra ficha com o nome "' + t(nomes[i]) + '" (' + (t(ids[i]) || 'sem ID') + '). Use "Juntar" se for a mesma pessoa.' };
    }
  }

  if (!id) {
    const novo = await criarFicha(shC, { nome, telefone, empresa: params.empresa, email: params.email, obs: params.obs, tipo: t(params.tipo), origem: 'Nilmar' });
    return { ok: true, id: novo, criado: true };
  }

  const row = ids.findIndex((v, i) => i > 0 && t(v) === id) + 1;
  if (row < 2) return { error: 'Ficha ' + id + ' não encontrada.' };
  const nomeAntigo = t(nomes[row - 1]);
  const ups = [
    { key: 'Nome do Cliente', val: nome },
    { key: 'Tipo', val: t(params.tipo) },
    { key: 'Origem', val: 'Nilmar' },
  ];
  if (params.telefone !== undefined) ups.push({ key: 'Contato do Cliente', val: telefone, forceText: true });
  if (params.empresa !== undefined) ups.push({ key: 'Empresa do Cliente', val: t(params.empresa) });
  if (params.email !== undefined) ups.push({ key: 'Email do Cliente', val: t(params.email) });
  if (params.obs !== undefined) ups.push({ key: 'Observação', val: t(params.obs) });
  await G.updateRowCells(shC.title, row, shC.headers, ups);

  let obrasRenomeadas = 0;
  if (nome !== nomeAntigo) {
    const oIds = await G.readColumn(shO.title, shO.headers.indexOf('ID Cliente'));
    const list = [];
    for (let i = 1; i < oIds.length; i++) if (t(oIds[i]) === id) list.push({ rowNum: i + 1, updates: [{ key: 'Nome do Cliente', val: nome }] });
    await G.batchUpdateRows(shO.title, shO.headers, list);
    obrasRenomeadas = list.length;
  }
  return { ok: true, id, obrasRenomeadas };
}

// "Está certo assim": confirma a ficha sem mudar nada além da origem.
async function crmConfirmarCliente(params) {
  const id = t(params.id);
  if (!id) return { error: 'Ficha não informada.' };
  const { shC } = await abasCrm();
  const row = await linhaDoCliente(shC, id);
  if (!row) return { error: 'Ficha ' + id + ' não encontrada.' };
  const ups = [{ key: 'Origem', val: 'Nilmar' }];
  if (params.tipo !== undefined) {
    if (!validaTipo(params.tipo)) return { error: 'Tipo inválido.' };
    ups.push({ key: 'Tipo', val: t(params.tipo) });
  }
  await G.updateRowCells(shC.title, row, shC.headers, ups);
  return { ok: true };
}

// Junta duas fichas da mesma pessoa. As obras (e o histórico de contato, quando
// existir) passam para o destino; campos vazios do destino herdam da origem; a
// ficha de origem é apagada por último, para não deslocar as linhas antes da hora.
async function crmJuntarClientes(params) {
  const origemId = t(params.origem), destinoId = t(params.destino);
  if (!origemId || !destinoId) return { error: 'Informe as duas fichas.' };
  if (origemId === destinoId) return { error: 'Escolha duas fichas diferentes.' };
  const { shC, shO, index } = await abasCrm();
  const linhas = await lerLinhas(shC);
  const origem = linhas.find(c => t(c['ID Cliente']) === origemId);
  const destino = linhas.find(c => t(c['ID Cliente']) === destinoId);
  if (!origem) return { error: 'Ficha ' + origemId + ' não encontrada.' };
  if (!destino) return { error: 'Ficha ' + destinoId + ' não encontrada.' };
  // telefones diferentes = pessoas diferentes — foi assim que separamos as duas "Kate"
  const fo = foneDe(origem['Contato do Cliente']), fd = foneDe(destino['Contato do Cliente']);
  if (fo && fd && fo !== fd && !params.forcar) {
    return { error: 'As duas fichas têm telefones diferentes (' + fmtFone(fo) + ' e ' + fmtFone(fd) + '). Confirme que é a mesma pessoa.', telefonesDiferentes: true };
  }

  const nomeDestino = t(destino['Nome do Cliente']);
  const oIds = await G.readColumn(shO.title, shO.headers.indexOf('ID Cliente'));
  const listObras = [];
  for (let i = 1; i < oIds.length; i++) {
    if (t(oIds[i]) === origemId) listObras.push({ rowNum: i + 1, updates: [
      { key: 'ID Cliente', val: destinoId }, { key: 'Nome do Cliente', val: nomeDestino }] });
  }
  await G.batchUpdateRows(shO.title, shO.headers, listObras);

  // histórico de contatos (aba criada na Parte 2; se não existir, nada a mover)
  const shH = G.findSheetEntry(index, ['destinatário', 'marco']);
  if (shH) {
    const hIds = await G.readColumn(shH.title, shH.headers.indexOf('ID Cliente'));
    const listH = [];
    for (let i = 1; i < hIds.length; i++) if (t(hIds[i]) === origemId) listH.push({ rowNum: i + 1, updates: [{ key: 'ID Cliente', val: destinoId }] });
    await G.batchUpdateRows(shH.title, shH.headers, listH);
  }

  const herda = [];
  [['Contato do Cliente', true], ['Empresa do Cliente'], ['Email do Cliente'], ['Canal Preferido']].forEach(([k, txt]) => {
    if (!t(destino[k]) && t(origem[k])) herda.push({ key: k, val: t(origem[k]), forceText: !!txt });
  });
  herda.push({ key: 'Origem', val: 'Nilmar' });
  await G.updateRowCells(shC.title, destino._row, shC.headers, herda);

  await G.deleteRow(shC.sheetId, origem._row);
  return { ok: true, obrasMovidas: listObras.length };
}

// Liga a obra a uma ficha (ou desliga, com id vazio → volta para "A identificar").
// O nome da obra passa a ser o da ficha; o telefone só entra se a obra não tinha.
async function crmVincularObra(params) {
  const addr = t(params.addr);
  if (!addr) return { error: 'Endereço obrigatório.' };
  const { shC, shO } = await abasCrm();
  const row = await linhaDaObra(shO, addr);
  if (!row) return { error: 'Obra não encontrada.' };
  const id = t(params.id);
  if (!id) {
    await G.updateRowCells(shO.title, row, shO.headers, [{ key: 'ID Cliente', val: '' }]);
    return { ok: true, desvinculada: true };
  }
  const linhas = await lerLinhas(shC);
  const ficha = linhas.find(c => t(c['ID Cliente']) === id);
  if (!ficha) return { error: 'Ficha ' + id + ' não encontrada.' };
  const contatoObra = (await G.readColumn(shO.title, shO.headers.indexOf('Contato')))[row - 1];
  const ups = [{ key: 'ID Cliente', val: id }, { key: 'Nome do Cliente', val: t(ficha['Nome do Cliente']) }];
  if (!foneDe(contatoObra) && foneDe(ficha['Contato do Cliente'])) ups.push({ key: 'Contato', val: t(ficha['Contato do Cliente']), forceText: true });
  await G.updateRowCells(shO.title, row, shO.headers, ups);
  return { ok: true };
}

// Data de conclusão: aceitar a sugestão (ou digitar outra) ou manter a atual.
// Nos dois casos a obra fica "conferida" e a sugestão não volta.
async function crmDataConclusao(params) {
  const addr = t(params.addr);
  if (!addr) return { error: 'Endereço obrigatório.' };
  const { shO } = await abasCrm();
  const row = await linhaDaObra(shO, addr);
  if (!row) return { error: 'Obra não encontrada.' };
  if (params.manter) {
    await G.updateRowCells(shO.title, row, shO.headers, [{ key: 'Conclusão Conferida', val: 'Sim' }]);
    return { ok: true, mantida: true };
  }
  const data = t(params.data);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { error: 'Data inválida.' };
  if (data > new Date().toISOString().slice(0, 10)) return { error: 'A conclusão não pode ser no futuro.' };
  await G.updateRowCells(shO.title, row, shO.headers, [
    { key: 'Data Finalização', val: data }, { key: 'Conclusão Conferida', val: 'Sim' }]);
  return { ok: true };
}

module.exports = {
  // puros (testados em scripts/test-crm-fichas.js)
  planejarFichas, tipoSugerido, nomeCanonico, geradorIds, foneDe, fmtFone, norm, baseAddr, nomeValido,
  // planilha
  garantirColunas, criarFicha, fichaPorNomeOuCriar, abasCrm, COLS_CLIENTE, COLS_OBRA, TIPOS,
  // ações
  crmPreparar, crmSalvarCliente, crmConfirmarCliente, crmJuntarClientes, crmVincularObra, crmDataConclusao,
};
