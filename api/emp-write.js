const { verifyEmpToken, getCookieValue, readBody } = require('./_emp-auth');
const { addLabor } = require('./_actions');
const { getOrCreateFolder, uploadFile } = require('./_drive');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = getCookieValue(req.headers.cookie, 'njr_emp_token');
  const secret = process.env.EMP_JWT_SECRET || process.env.JWT_SECRET;
  const empName = verifyEmpToken(token, secret);
  if (!empName) return res.status(401).json({ error: 'Não autorizado.' });

  const body = await readBody(req);
  const { action, ...params } = body;

  try {
    let data;
    if (action === 'uploadFile') {
      data = await uploadFile(params);
    } else if (action === 'getOrCreateFolder') {
      data = await getOrCreateFolder(params);
    } else if (action === 'addLabor') {
      // Nome do funcionário vem SEMPRE do token, nunca do corpo da requisição
      data = await addLabor({ ...params, emp: empName });
    } else {
      return res.status(400).json({ error: 'Ação desconhecida: ' + action });
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Erro: ' + err.message });
  }
};
