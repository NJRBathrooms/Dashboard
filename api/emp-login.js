const { createEmpToken, readBody } = require('./_emp-auth');
const { readEmpCredentials } = require('./_google');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = await readBody(req);
  const { password } = body;
  if (!password) return res.status(401).json({ error: 'Senha obrigatória.' });

  try {
    const creds = await readEmpCredentials(); // lê a aba "Funcionários" (Nome/Senha)
    const match = creds.find(c => c.senha === password);
    if (!match) return res.status(401).json({ error: 'Senha incorreta.' });

    const secret = process.env.EMP_JWT_SECRET || process.env.JWT_SECRET;
    const token = createEmpToken(match.nome, secret);
    const maxAge = 30 * 24 * 60 * 60; // 30 dias
    res.setHeader('Set-Cookie', `njr_emp_token=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}`);
    return res.status(200).json({ ok: true, emp: match.nome });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor: ' + err.message });
  }
};
