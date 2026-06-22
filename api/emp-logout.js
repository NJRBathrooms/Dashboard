module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  res.setHeader('Set-Cookie', 'njr_emp_token=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
  return res.status(200).json({ ok: true });
};
