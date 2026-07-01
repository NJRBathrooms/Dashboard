const { verifyToken, getCookieValue } = require('./_auth');
const { readAllRentals } = require('./_rentals');

module.exports = async function handler(req, res) {
  const token = getCookieValue(req.headers.cookie, 'njr_token');
  if (!verifyToken(token, process.env.JWT_SECRET)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  try {
    return res.status(200).json(await readAllRentals());
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar dados: ' + err.message });
  }
};
