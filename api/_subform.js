// ============================================================
// NJR Bathrooms — chave do formulário público de subcontratados
// (Insurance & W9). O formulário fica atrás de um link com chave
// (?key=...) em vez de login: a chave é derivada do JWT_SECRET,
// então não precisa de variável de ambiente nova. Trocar o
// JWT_SECRET rotaciona o link.
// ============================================================

const crypto = require('crypto');

function subFormKey() {
  const secret = process.env.JWT_SECRET || 'njr';
  return crypto.createHmac('sha256', secret).update('njr-sub-form-v1').digest('hex').slice(0, 40);
}

function checkSubFormKey(key) {
  const expected = subFormKey();
  if (typeof key !== 'string' || !key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  // timingSafeEqual lança erro com tamanhos diferentes — checa antes
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { subFormKey, checkSubFormKey };
