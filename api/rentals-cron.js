// ============================================================
// NJR Casas de Aluguel — Cron diário (Vercel Cron)
// Verifica vencimento de CONTRATO e SEGURO de cada casa e envia e-mail
// à Paulinha 2 meses e 1 mês antes. Dedupe via aba "Alertas".
// ============================================================

const R = require('./_rentals');
const { sendEmail } = require('./_google');

const PAULINHA = process.env.PAULINHA_EMAIL || 'Paulinhajusten@hotmail.com';

function parseDate(v) { if (!v) return null; const d = new Date(String(v).replace(/\//g, '-')); return isNaN(d.getTime()) ? null : d; }
function isoDate(d) { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function fmtBR(d) { const p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); }
function daysUntil(d) { const t = new Date(); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0); return Math.round((x - t) / 86400000); }
// marco aplicável: '1m' (<=30d) ou '2m' (<=60d); null fora da janela
function marcoFor(days) { if (days < 0) return null; if (days <= 30) return '1m'; if (days <= 60) return '2m'; return null; }

function emailContrato(casa, venc, faltamLabel) {
  const subject = 'Contrato de aluguel a vencer — ' + casa.addr + ' (faltam ' + faltamLabel + ')';
  const html = `
<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.6;max-width:620px">
  <p>Olá, Paulinha.</p>
  <p>O contrato de aluguel da casa abaixo está próximo do vencimento:</p>
  <p>
    🏠 <strong>Casa:</strong> ${casa.addr}<br>
    👤 <strong>Inquilino:</strong> ${casa.inquilino || '—'}<br>
    📅 <strong>Vencimento do contrato:</strong> ${venc}<br>
    ⏳ <strong>Faltam:</strong> ${faltamLabel}
  </p>
  <p><strong>Ação sugerida:</strong> contatar o inquilino para renovação ou definição sobre a continuidade.</p>
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
  <p style="font-size:12px;color:#888"><em>Enviado automaticamente pelo sistema NJR Casas de Aluguel.</em></p>
</div>`;
  return { subject, html };
}
function emailSeguro(casa, venc, faltamLabel) {
  const subject = 'Seguro residencial a vencer — ' + casa.addr + ' (faltam ' + faltamLabel + ')';
  const html = `
<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.6;max-width:620px">
  <p>Olá, Paulinha.</p>
  <p>O seguro residencial da casa abaixo está próximo do vencimento:</p>
  <p>
    🏠 <strong>Casa:</strong> ${casa.addr}<br>
    🛡️ <strong>Seguradora:</strong> ${casa.seguradora || '—'}<br>
    📅 <strong>Vigência até:</strong> ${venc}<br>
    ⏳ <strong>Faltam:</strong> ${faltamLabel}
  </p>
  <p><strong>Ação sugerida:</strong> providenciar a renovação do seguro para manter a cobertura.</p>
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
  <p style="font-size:12px;color:#888"><em>Enviado automaticamente pelo sistema NJR Casas de Aluguel.</em></p>
</div>`;
  return { subject, html };
}

module.exports = async function handler(req, res) {
  // Proteção: se CRON_SECRET estiver definido, exige o Bearer que a Vercel envia
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET) return res.status(401).json({ error: 'Não autorizado.' });
  }

  try {
    const ssId = await R.getRentalsSS();
    const data = await R.readAllRentals();
    const sent = new Set((data.alertas || []).map(a => a['Tipo'] + '|' + a['Endereço'] + '|' + a['Marco']));
    const results = [];

    const checks = [];
    (data.casas || []).forEach(c => {
      const addr = String(c['Endereço'] || '').trim();
      if (!addr) return;
      const casa = { addr, inquilino: c['Inquilino'], seguradora: c['Seguradora'] };
      checks.push({ tipo: 'Contrato', casa, dateStr: c['Fim do Contrato'] });
      checks.push({ tipo: 'Seguro', casa, dateStr: c['Vigência do Seguro'] });
    });

    for (const ch of checks) {
      const d = parseDate(ch.dateStr);
      if (!d) continue;
      const days = daysUntil(d);
      const marco = marcoFor(days);
      if (!marco) continue;
      const marcoKey = marco + '@' + isoDate(d);
      const dedupeKey = ch.tipo + '|' + ch.casa.addr + '|' + marcoKey;
      if (sent.has(dedupeKey)) continue;

      const faltam = marco === '1m' ? '1 mês' : '2 meses';
      const mail = ch.tipo === 'Contrato' ? emailContrato(ch.casa, fmtBR(d), faltam) : emailSeguro(ch.casa, fmtBR(d), faltam);
      try {
        await sendEmail(PAULINHA, mail.subject, mail.html, true);
        await R.appendRental(ssId, 'Alertas', R.buildRow(R.TABS.Alertas, [
          { key: 'Tipo', val: ch.tipo },
          { key: 'Endereço', val: ch.casa.addr },
          { key: 'Marco', val: marcoKey, forceText: true },
          { key: 'Enviado em', val: R.nowInTz() },
        ]));
        sent.add(dedupeKey);
        results.push({ tipo: ch.tipo, addr: ch.casa.addr, marco, sent: true });
      } catch (e) {
        results.push({ tipo: ch.tipo, addr: ch.casa.addr, marco, error: e.message });
      }
    }

    // Insurance & W9 (subcontratados da NJR Bathrooms) — roda no mesmo cron
    // diário para não gastar outra função serverless (limite de 12 no Hobby).
    // Falha aqui não derruba os alertas de aluguel.
    let insurance = null;
    try {
      const { runInsuranceCheck } = require('./_insurance-check');
      insurance = await runInsuranceCheck();
    } catch (e) {
      insurance = { error: e.message };
    }

    return res.status(200).json({ ok: true, checked: checks.length, alertas: results, insurance });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
