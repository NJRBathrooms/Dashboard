const { createToken, readBody } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = await readBody(req);
  const { password } = body;

  if (!password || password !== process.env.NJR_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }

  const token = createToken(process.env.JWT_SECRET);
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  res.setHeader('Set-Cookie', `njr_token=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}`);
  return res.status(200).json({ ok: true });
};
