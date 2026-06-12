const { verifyToken, getCookieValue } = require('./_auth');

module.exports = async function handler(req, res) {
  const token = getCookieValue(req.headers.cookie, 'njr_token');
  if (!verifyToken(token, process.env.JWT_SECRET)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  try {
    const url = process.env.APPS_SCRIPT_URL + '?t=' + Date.now();
    const response = await fetch(url);
    const text = await response.text();
    const data = JSON.parse(text);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar dados: ' + err.message });
  }
};
