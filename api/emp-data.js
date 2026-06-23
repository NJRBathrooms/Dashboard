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

    return res.status(200).json({ emp: empName, labor: myLabor, allAddrs });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar dados: ' + err.message });
  }
};
