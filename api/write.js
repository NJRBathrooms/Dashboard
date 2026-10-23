const { verifyToken, getCookieValue, readBody } = require('./_auth');
const A = require('./_actions');
const CRM = require('./_crm');
const CURSO = require('./_curso');
const { getOrCreateFolder, uploadFile } = require('./_drive');

const HANDLERS = {
  // CRM (docs/2026-10-14-crm-design.md)
  crmPreparar: CRM.crmPreparar,
  crmSalvarCliente: CRM.crmSalvarCliente,
  crmConfirmarCliente: CRM.crmConfirmarCliente,
  crmJuntarClientes: CRM.crmJuntarClientes,
  crmVincularObra: CRM.crmVincularObra,
  crmDataConclusao: CRM.crmDataConclusao,
  crmRegistrarContato: CRM.crmRegistrarContato,
  crmDesfazerContato: CRM.crmDesfazerContato,
  crmAutorizarMorador: CRM.crmAutorizarMorador,
  crmNaoContatar: CRM.crmNaoContatar,
  addObra: A.addObra,
  closeObra: A.closeObra,
  updateObra: A.updateObra,
  completarObra: A.completarObra,
  addMaterial: A.addMaterial,
  updateMaterial: A.updateMaterial,
  deleteMaterial: A.deleteMaterial,
  addSubcontrato: A.addSubcontrato,
  updateSubcontrato: A.updateSubcontrato,
  deleteSubcontrato: A.deleteSubcontrato,
  addCliente: A.addCliente,
  saveAjuste: A.saveAjuste,
  addDescontoProgramado: A.addDescontoProgramado,
  updateDescontoProgramado: A.updateDescontoProgramado,
  deleteDescontoProgramado: A.deleteDescontoProgramado,
  marcarParcelaDesconto: A.marcarParcelaDesconto,
  emailReport: A.emailReport,
  emailInvoice: A.emailInvoice,
  updateSubProfile: A.updateSubProfile,
  deleteSubProfile: A.deleteSubProfile,
  saveFuncionario: A.saveFuncionario,
  deleteFuncionario: A.deleteFuncionario,
  addRateChange: A.addRateChange,
  deleteRateChange: A.deleteRateChange,
  addDrywall: A.addDrywall,
  updateDrywall: A.updateDrywall,
  updateDrywallServico: A.updateDrywallServico,
  deleteDrywallServico: A.deleteDrywallServico,
  renameDrywallCliente: A.renameDrywallCliente,
  deleteDrywall: A.deleteDrywall,
  updateLabor: A.updateLabor,
  deleteLabor: A.deleteLabor,
  getSubFormLink: A.getSubFormLink,
  sendSubInvite: A.sendSubInvite,
  // Curso Schluter — lista de interessados (formulário público em /curso-schluter)
  getCursoLink: CURSO.getCursoLink,
  deleteCursoInscrito: CURSO.deleteCursoInscrito,
  getOrCreateFolder,
  uploadFile,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = await readBody(req);
  const { action, ...params } = body;

  // Formulário PÚBLICO de subcontratados (Insurance & W9): sem login —
  // valida a chave que vai no link (?key=) em vez do cookie de sessão.
  if (action === 'subFormUpload' || action === 'subFormSubmit') {
    const { checkSubFormKey } = require('./_subform');
    if (!checkSubFormKey(params.key)) {
      return res.status(403).json({ error: 'Invalid or expired link. Please ask NJR Bathrooms for a new one.' });
    }
    try {
      const SF = require('./_subform-api');
      const fn = action === 'subFormUpload' ? SF.subFormUpload : SF.subFormSubmit;
      return res.status(200).json(await fn(params));
    } catch (err) {
      return res.status(500).json({ error: 'Error: ' + err.message });
    }
  }

  // Lista do curso Schluter (/curso-schluter): link PÚBLICO, postado em grupos.
  // Sem login; a validação, o anti-robô e o limite por IP ficam em _curso.js.
  // O erro interno nunca vai para quem preenche — só para o log da Vercel.
  if (action === 'cursoStatus' || action === 'cursoInscrever') {
    if (!CURSO.checkCursoKey(params.key)) {
      return res.status(403).json({ error: 'Este link não está mais ativo. / This link is no longer active.', fechado: true });
    }
    if (action === 'cursoStatus') return res.status(200).json({ ok: true });
    try {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'] || '';
      return res.status(200).json(await CURSO.cursoInscrever(params, ip));
    } catch (err) {
      console.error('cursoInscrever:', err);
      return res.status(500).json({ error: 'Não foi possível salvar agora. Tente de novo em instantes. / Could not save right now — please try again.' });
    }
  }

  const token = getCookieValue(req.headers.cookie, 'njr_token');
  if (!verifyToken(token, process.env.JWT_SECRET)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  const fn = HANDLERS[action];
  if (!fn) return res.status(400).json({ error: 'Ação desconhecida: ' + action });

  try {
    const data = await fn(params);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Erro: ' + err.message });
  }
};
