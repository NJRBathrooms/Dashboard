const { verifyToken, getCookieValue } = require('./_auth');
const { readAll } = require('./_google');

module.exports = async function handler(req, res) {
  const token = getCookieValue(req.headers.cookie, 'njr_token');
  if (!verifyToken(token, process.env.JWT_SECRET)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  try {
    const data = await readAll();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar dados: ' + err.message });
  }
};
