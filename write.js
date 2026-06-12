const { verifyToken, getCookieValue } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = getCookieValue(req.headers.cookie, 'njr_token');
  if (!verifyToken(token, process.env.JWT_SECRET)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  const body = req.body || {};
  const { action, ...params } = body;
  const appsUrl = process.env.APPS_SCRIPT_URL;

  try {
    let data;

    if (action === 'uploadFile') {
      // Forward as POST to Apps Script doPost
      const formBody = new URLSearchParams({ action: 'uploadFile', ...params });
      const response = await fetch(appsUrl, {
        method: 'POST',
        body: formBody,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      data = await response.json();
    } else {
      // Forward as GET to Apps Script doGet (addObra, closeObra, getOrCreateFolder, etc.)
      const qs = new URLSearchParams({ action, ...params });
      const response = await fetch(`${appsUrl}?${qs}`);
      const text = await response.text();
      data = JSON.parse(text);
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Erro: ' + err.message });
  }
};
