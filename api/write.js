const { verifyToken, getCookieValue, readBody } = require('./_auth');
const A = require('./_actions');
const { getOrCreateFolder, uploadFile } = require('./_drive');

const HANDLERS = {
  addObra: A.addObra,
  closeObra: A.closeObra,
  updateObra: A.updateObra,
  addMaterial: A.addMaterial,
  updateMaterial: A.updateMaterial,
  deleteMaterial: A.deleteMaterial,
  addSubcontrato: A.addSubcontrato,
  updateSubcontrato: A.updateSubcontrato,
  deleteSubcontrato: A.deleteSubcontrato,
  addCliente: A.addCliente,
  saveAjuste: A.saveAjuste,
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
  deleteDrywall: A.deleteDrywall,
  updateLabor: A.updateLabor,
  deleteLabor: A.deleteLabor,
  getSubFormLink: A.getSubFormLink,
  sendSubInvite: A.sendSubInvite,
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
