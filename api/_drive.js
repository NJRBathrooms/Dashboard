// ============================================================
// NJR Bathrooms — fotos no Google Drive via Drive API v3
// Roda como o dono (OAuth), então as fotos ficam no Drive dele e visíveis.
// Escopo usado: drive.file (o app enxerga/gerencia só o que ele mesmo cria).
// ============================================================

const { driveApi } = require('./_google');

const ROOT_NAME = 'NJR Bathrooms - Fotos';

function safeName(addr) {
  return String(addr || '').replace(/[\/\\:*?"<>|]/g, '-').substring(0, 100);
}

// Procura uma subpasta pelo nome dentro de um pai (entre as criadas pelo app); cria se faltar.
async function findOrCreateFolder(drive, name, parentId) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false${parentClause}`,
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: 1,
  });
  if (res.data.files && res.data.files.length) return res.data.files[0].id;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
  });
  return created.data.id;
}

// Garante a árvore  NJR Bathrooms - Fotos / NJR - {endereço} / {subpasta}
// e devolve { id, url } da subpasta (compatível com o retorno do Apps Script).
async function getOrCreateFolder(params) {
  const addr = (params.addr || '').trim();
  if (!addr) return { error: 'Endereço obrigatório.' };
  const subfolder = params.subfolder || 'Antes';
  const drive = driveApi();

  const rootId = await findOrCreateFolder(drive, ROOT_NAME, null);
  const obraId = await findOrCreateFolder(drive, 'NJR - ' + safeName(addr), rootId);
  const subId  = await findOrCreateFolder(drive, subfolder, obraId);

  // Compartilha a subpasta como "qualquer um com o link pode ver" (1x), para os links
  // de foto abrirem no dashboard sem pedir login. Falha não-fatal.
  try {
    await drive.permissions.create({
      fileId: subId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
  } catch (_) {}

  const url = `https://drive.google.com/drive/folders/${subId}`;
  return { ok: true, url, id: subId };
}

// Faz upload de uma imagem (base64) para a pasta e devolve { fileUrl, fileId, name }.
async function uploadFile(params) {
  const folderId = (params.folderId || '').trim();
  const fileBase64 = (params.fileBase64 || '').trim();
  const fileName = (params.fileName || 'foto.jpg').trim();
  const mimeType = (params.mimeType || 'image/jpeg').trim();
  if (!folderId) return { error: 'ID da pasta é obrigatório.' };
  if (!fileBase64) return { error: 'Dados da imagem são obrigatórios.' };

  const drive = driveApi();
  const { Readable } = require('stream');
  const buffer = Buffer.from(fileBase64, 'base64');

  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,webViewLink',
  });

  return { ok: true, fileUrl: created.data.webViewLink, fileId: created.data.id, name: fileName };
}

module.exports = { getOrCreateFolder, uploadFile, findOrCreateFolder, safeName, ROOT_NAME };
