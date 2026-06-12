module.exports = function handler(req, res) {
  res.setHeader('Set-Cookie', 'njr_token=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
  return res.status(200).json({ ok: true });
};
