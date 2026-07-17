// ============================================================
// NJR Bathrooms — Cron diário (Vercel Cron): Insurance & W9
// Olha o cadastro mais recente de cada empresa subcontratada e
// avisa o Nilmar quando o seguro (Workers' Comp) vence em <=30
// dias ou já venceu. Dedupe via colunas Alerted30/AlertedExpired,
// gravadas SÓ depois do e-mail sair — falhou, tenta de novo amanhã.
// ============================================================

const G = require('./_google');
const A = require('./_actions');

const NILMAR = process.env.NOTIFY_EMAIL || 'tenilmar@icloud.com';
const WINDOW_DAYS = 30;

const norm = s => String(s || '').trim().toLowerCase();

function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
}
function daysUntil(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  return Math.round((x - t) / 86400000);
}
function fmtBR(iso) {
  const d = parseIso(iso);
  if (!d) return String(iso || '—');
  const p = n => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

// Só o cadastro mais novo de cada empresa vale — reenvios (renovação de
// seguro) substituem o anterior; os antigos ficam de histórico no Registry.
function latestPerCompany(rows) {
  const byCompany = new Map();
  for (const r of rows) {
    const key = norm(r['Company Name']);
    if (!key) continue;
    const prev = byCompany.get(key);
    if (!prev || String(r['Carimbo de data/hora'] || '') > String(prev['Carimbo de data/hora'] || '')) byCompany.set(key, r);
  }
  return [...byCompany.values()];
}

function tableHTML(rows, color, title) {
  return `
  <h3 style="margin:18px 0 6px;color:${color}">${title}</h3>
  <table style="border-collapse:collapse;font-size:13px;width:100%">
    <thead><tr style="background:${color};color:#fff;text-align:left">
      <th style="padding:8px 10px">Empresa</th><th style="padding:8px 10px">Responsável</th>
      <th style="padding:8px 10px">Apólice</th><th style="padding:8px 10px">Vencimento</th>
      <th style="padding:8px 10px;text-align:right">Dias</th><th style="padding:8px 10px">COI</th>
    </tr></thead>
    <tbody>${rows.map(r => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e6edf5;font-weight:600">${r.company}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6edf5">${r.owner}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6edf5">${r.policy || '—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6edf5">${r.venc}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6edf5;text-align:right;font-weight:700">${r.days < 0 ? ('há ' + (-r.days)) : r.days}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6edf5">${r.coi ? `<a href="${r.coi}">Ver COI</a>` : '—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

module.exports = async function handler(req, res) {
  // Proteção: se CRON_SECRET estiver definido, exige o Bearer que a Vercel envia
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET) return res.status(401).json({ error: 'Não autorizado.' });
  }

  try {
    const data = await G.readAll();
    const latest = latestPerCompany(data.subProfiles || []);

    const toItem = (r, days) => ({
      company: String(r['Company Name'] || ''), owner: String(r['Owner Name'] || ''),
      policy: String(r['COI Policy Number'] || ''), venc: fmtBR(r['Insurance Expiration']),
      days, coi: String(r['COI URL'] || '').split(/\s+/)[0] || '',
    });

    const expired = [], expiring = [];
    for (const r of latest) {
      const d = parseIso(r['Insurance Expiration']);
      if (!d) continue;
      const days = daysUntil(d);
      if (days < 0 && String(r['AlertedExpired']).toUpperCase() !== 'TRUE') {
        expired.push({ row: r, item: toItem(r, days) });
      } else if (days >= 0 && days <= WINDOW_DAYS && String(r['Alerted30']).toUpperCase() !== 'TRUE') {
        expiring.push({ row: r, item: toItem(r, days) });
      }
    }

    if (!expired.length && !expiring.length) {
      return res.status(200).json({ ok: true, expired: 0, expiring: 0 });
    }

    const html = `
<div style="font-family:Arial,sans-serif;max-width:720px;color:#1a2b3c">
  <h2 style="margin-bottom:2px">Seguro de Subcontratados — atenção</h2>
  <p style="margin:0 0 8px;color:#6b7c90">
    O seguro (Workers' Compensation) dos subcontratados abaixo precisa de atenção.
    Peça um Certificate of Insurance atualizado — eles podem reenviar pelo mesmo link do formulário.
  </p>
  ${expired.length ? tableHTML(expired.map(x => x.item), '#c0392b', 'VENCIDOS') : ''}
  ${expiring.length ? tableHTML(expiring.map(x => x.item), '#b45309', 'VENCEM EM ATÉ 30 DIAS') : ''}
  <p style="color:#8f9bab;font-size:12px;margin-top:18px">— NJR Bathrooms · Insurance &amp; W9</p>
</div>`;
    await G.sendEmail(
      NILMAR,
      'Seguro de subcontratados: ' + expired.length + ' vencido(s), ' + expiring.length + ' vencendo em 30 dias',
      html, true
    );

    // Flags só depois do envio. Linha vencida também recebe Alerted30 — um
    // alerta atrasado de "30 dias" nunca deve disparar depois do de vencido.
    const { index } = await G.loadSheetIndex();
    const sh = index.find(s => s.title === A.SUBPROF_SHEET);
    if (sh) {
      for (const { row } of expired) {
        await G.updateRowCells(sh.title, row._row, sh.headers, [
          { key: 'AlertedExpired', val: 'TRUE' }, { key: 'Alerted30', val: 'TRUE' },
        ]);
      }
      for (const { row } of expiring) {
        await G.updateRowCells(sh.title, row._row, sh.headers, [{ key: 'Alerted30', val: 'TRUE' }]);
      }
    }

    return res.status(200).json({ ok: true, expired: expired.length, expiring: expiring.length });
  } catch (err) {
    return res.status(500).json({ error: 'Erro: ' + err.message });
  }
};
