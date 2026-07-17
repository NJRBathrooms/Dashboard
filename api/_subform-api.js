// ============================================================
// NJR Bathrooms — handlers do formulário PÚBLICO de subcontratados
// (Insurance & W9). Arquivo com underscore: NÃO vira função serverless
// (limite de 12 no plano Hobby) — é despachado pelo api/write.js, que
// valida a chave do link (?key=) em vez do cookie de login.
// ============================================================

const { driveApi } = require('./_google');
const { findOrCreateFolder, safeName, ROOT_NAME } = require('./_drive');

function isoDateValid(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

// Drive: NJR Bathrooms - Fotos / Subcontractors - Insurance & W9 / {empresa}
async function subFormUpload(b) {
  const fileBase64 = String(b.fileBase64 || '').trim();
  const fileName = String(b.fileName || 'document').trim().slice(0, 120) || 'document';
  const mimeType = String(b.mimeType || 'application/octet-stream').trim();
  const company = String(b.companyName || '').trim() || 'Unknown Company';
  const kind = b.kind === 'w9' ? 'W9' : 'COI';
  if (!fileBase64) return { error: 'File data is required.' };
  if (fileBase64.length > 8 * 1024 * 1024) return { error: 'File too large. Maximum 5 MB per file.' };

  const drive = driveApi();
  const rootId = await findOrCreateFolder(drive, ROOT_NAME, null);
  const subsId = await findOrCreateFolder(drive, 'Subcontractors - Insurance & W9', rootId);
  const compId = await findOrCreateFolder(drive, safeName(company), subsId);

  const { Readable } = require('stream');
  const buffer = Buffer.from(fileBase64, 'base64');
  const created = await drive.files.create({
    requestBody: { name: kind + '_' + Date.now() + '_' + safeName(fileName), parents: [compId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,webViewLink',
  });
  // link visível para quem tiver o link (o dono abre direto do dashboard)
  try {
    await drive.permissions.create({ fileId: created.data.id, requestBody: { role: 'reader', type: 'anyone' } });
  } catch (_) {}
  return { ok: true, url: created.data.webViewLink };
}

// Todos os campos são obrigatórios: um cadastro incompleto parece "em dia"
// enquanto falta documento — pior do que nenhum cadastro.
async function subFormSubmit(b) {
  const required = [
    ['ownerName', 'Owner full name is required'],
    ['companyName', 'Company legal name is required'],
    ['companyAddress', 'Company address is required'],
    ['email', 'Business email is required'],
    ['phone', 'Business phone is required'],
    ['coiPolicyNumber', 'COI policy number is required'],
    ['insuranceExpiration', 'Insurance expiration date is required'],
    ['coiUrl', 'The COI document upload is required'],
    ['ein', 'EIN is required'],
    ['w9Url', 'The signed W-9 upload is required'],
  ];
  for (const [field, msg] of required) {
    if (!String(b[field] || '').trim()) return { error: msg };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email).trim())) {
    return { error: 'Please enter a valid business email' };
  }
  if (!/^\d{2}-?\d{7}$/.test(String(b.ein).trim())) {
    return { error: 'EIN must be 9 digits (format XX-XXXXXXX)' };
  }
  if (!isoDateValid(b.insuranceExpiration)) {
    return { error: 'Insurance expiration date is not a valid date' };
  }
  const A = require('./_actions'); // require tardio evita ciclo _actions ↔ _subform*
  return A.addSubProfile({
    ownerName: String(b.ownerName).trim(),
    companyName: String(b.companyName).trim(),
    companyAddress: String(b.companyAddress).trim(),
    email: String(b.email).trim(),
    phone: String(b.phone).trim(),
    coiPolicyNumber: String(b.coiPolicyNumber).trim(),
    insuranceExpiration: String(b.insuranceExpiration).trim(),
    coiUrl: String(b.coiUrl).trim(),
    ein: String(b.ein).trim(),
    w9Url: String(b.w9Url).trim(),
  });
}

module.exports = { subFormUpload, subFormSubmit };
