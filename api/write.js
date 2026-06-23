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
  getOrCreateFolder,
  uploadFile,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = getCookieValue(req.headers.cookie, 'njr_token');
  if (!verifyToken(token, process.env.JWT_SECRET)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  const body = await readBody(req);
  const { action, ...params } = body;
  const fn = HANDLERS[action];
  if (!fn) return res.status(400).json({ error: 'Ação desconhecida: ' + action });

  try {
    const data = await fn(params);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Erro: ' + err.message });
  }
};
