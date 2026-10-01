const { verifyEmpToken, getCookieValue } = require('./_emp-auth');
const { readEmpData, normStr } = require('./_google');

// Obra encerrada pelo Nilmar não pode mais receber horas: some da lista do app.
// O endereço também é removido quando vem do histórico de labor — senão a obra
// voltaria para a lista pela porta dos fundos, já que o pessoal lançou horas nela.
// Obra legada (só no labor, sem ficha em Cadastro de Obras) continua disponível.
function enderecosDisponiveis(obras, labor) {
  const finalizadas = new Set();
  (obras || []).forEach(o => {
    const a = String(o['Endereço'] || '').trim();
    if (a && /^s/i.test(String(o['Finalizada'] || '').trim())) finalizadas.add(normStr(a));
  });

  const addrSet = new Set();
  const add = a => { const v = String(a || '').trim(); if (v && !finalizadas.has(normStr(v))) addrSet.add(v); };
  (obras || []).forEach(o => add(o['Endereço']));
  (labor || []).forEach(r => add(r['Endereço da obra']));
  return [...addrSet].sort();
}

async function handler(req, res) {
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

    // Endereços de obras abertas (Cadastro de Obras + obras legadas presentes no labor)
    const allAddrs = enderecosDisponiveis(data.obras, data.labor);

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

    // Histórico de rate deste funcionário (cada item vale a partir de "desde")
    const myRates = (data.rateHistory || [])
      .filter(r => r.nome === empName)
      .map(r => ({ rate: r.rate, desde: r.desde }))
      .sort((a, b) => a.desde.localeCompare(b.desde));

    return res.status(200).json({ emp: empName, labor: myLabor, allAddrs, ajustes: myAdj, rate, rateHistory: myRates });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar dados: ' + err.message });
  }
}

module.exports = handler;
module.exports.enderecosDisponiveis = enderecosDisponiveis;
