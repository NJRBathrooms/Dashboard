const { verifyEmpToken, getCookieValue, readBody } = require('./_emp-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = getCookieValue(req.headers.cookie, 'njr_emp_token');
  const secret = process.env.EMP_JWT_SECRET || process.env.JWT_SECRET;
  const empName = verifyEmpToken(token, secret);
  if (!empName) return res.status(401).json({ error: 'Não autorizado.' });

  const body = await readBody(req);
  const { action, ...params } = body;
  const appsUrl = process.env.APPS_SCRIPT_URL;

  try {
    let data;

    if (action === 'uploadFile') {
      // Forward photo upload as POST to Apps Script doPost
      const formBody = new URLSearchParams({ action: 'uploadFile', ...params });
      const response = await fetch(appsUrl, {
        method: 'POST',
        body: formBody,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      data = await response.json();
    } else if (action === 'getOrCreateFolder') {
      // GET request to Apps Script
      const qs = new URLSearchParams({ action: 'getOrCreateFolder', ...params });
      const response = await fetch(`${appsUrl}?${qs}`);
      const text = await response.text();
      data = JSON.parse(text);
    } else if (action === 'addLabor') {
      // Inject employee name from JWT — never trust the body for this
      const safeParams = { ...params, emp: empName };
      const qs = new URLSearchParams({ action: 'addLabor', ...safeParams });
      const response = await fetch(`${appsUrl}?${qs}`);
      const text = await response.text();
      data = JSON.parse(text);
    } else {
      return res.status(400).json({ error: 'Ação desconhecida: ' + action });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Erro: ' + err.message });
  }
};
