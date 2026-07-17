// ============================================================
// NJR Bathrooms — endpoint PÚBLICO do formulário de subcontratados
// (Insurance & W9). Sem login: subcontratados estão fora da empresa,
// então toda requisição valida a chave que vai no link (?key=...).
// Ações: upload (1 arquivo por request → Drive) e submit (grava linha).
// ============================================================

const { checkSubFormKey } = require('./_subform');
const { readBody } = require('./_auth');
const { driveApi } = require('./_google');
const { findOrCreateFolder, safeName, ROOT_NAME } = require('./_drive');
const A = require('./_actions');

function isoDateValid(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

// Drive: NJR Bathrooms - Fotos / Subcontractors - Insurance & W9 / {empresa}
async function handleUpload(b) {
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
async function handleSubmit(b) {
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = await readBody(req);
  if (!checkSubFormKey(body.key)) {
    return res.status(403).json({ error: 'Invalid or expired link. Please ask NJR Bathrooms for a new one.' });
  }
  try {
    if (body.action === 'upload') return res.status(200).json(await handleUpload(body));
    if (body.action === 'submit') return res.status(200).json(await handleSubmit(body));
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    return res.status(500).json({ error: 'Error: ' + err.message });
  }
};
