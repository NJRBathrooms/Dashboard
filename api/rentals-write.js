const { verifyToken, getCookieValue, readBody } = require('./_auth');
const A = require('./_rentals-actions');

const HANDLERS = {
  saveCasa: A.saveCasa,
  deleteCasa: A.deleteCasa,
  reorderCasas: A.reorderCasas,
  markRecebido: A.markRecebido,
  deleteRecebimento: A.deleteRecebimento,
  saveCusto: A.saveCusto,
  lancarCusto: A.lancarCusto,
  deleteCusto: A.deleteCusto,
  saveManutencao: A.saveManutencao,
  deleteManutencao: A.deleteManutencao,
  getDocsFolder: A.getDocsFolder,
  uploadFile: A.uploadFile,
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
    return res.status(200).json(await fn(params));
  } catch (err) {
    return res.status(500).json({ error: 'Erro: ' + err.message });
  }
};
