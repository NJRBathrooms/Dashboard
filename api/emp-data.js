const { verifyEmpToken, getCookieValue } = require('./_emp-auth');
const { readEmpData } = require('./_google');

module.exports = async function handler(req, res) {
  const token = getCookieValue(req.headers.cookie, 'njr_emp_token');
  const secret = process.env.EMP_JWT_SECRET || process.env.JWT_SECRET;
  const empName = verifyEmpToken(token, secret);
  if (!empName) return res.status(401).json({ error: 'Não autorizado.' });

  try {
    const data = await readEmpData();

    // Só os registros deste funcionário
    const myLabor = (data.labor || []).filter(r =>
      String(r['Nome do funcionário'] || '').trim() === empName
    );

    // Endereços de obras (Cadastro de Obras + obras legadas presentes no labor)
    const addrSet = new Set();
    (data.obras || []).forEach(o => {
      const a = String(o['Endereço'] || '').trim();
      if (a) addrSet.add(a);
    });
    (data.labor || []).forEach(r => {
      const a = String(r['Endereço da obra'] || '').trim();
      if (a) addrSet.add(a);
    });
    const allAddrs = [...addrSet].sort();

    // Ajustes (bonificação/desconto) só deste funcionário
    const myAdj = (data.ajustes || [])
      .filter(r => String(r['Nome do funcionário'] || '').trim() === empName)
      .map(r => ({
        week: String(r['Semana'] || '').trim(),
        bonif: Number(r['Bonificação']) || 0,
        justBonif: String(r['Justificativa Bonificação'] || ''),
        desc: Number(r['Desconto']) || 0,
        justDesc: String(r['Justificativa Desconto'] || ''),
      }));

    // Rate/h cadastrado na aba Funcionários (a senha nunca sai do servidor)
    const me = (data.funcionarios || []).find(f => String(f['Nome'] || '').trim() === empName);
    const rate = me ? (Number(me['Rate ($/h)']) || 0) : 0;

    return res.status(200).json({ emp: empName, labor: myLabor, allAddrs, ajustes: myAdj, rate });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar dados: ' + err.message });
  }
};
