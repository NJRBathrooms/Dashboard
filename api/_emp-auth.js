const crypto = require('crypto');
const { readBody, getCookieValue } = require('./_auth');

function createEmpToken(empName, secret) {
  const payload = Buffer.from(JSON.stringify({ emp: empName, iat: Date.now() })).toString('base64');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return payload + '.' + sig;
}

function verifyEmpToken(tokenStr, secret) {
  if (!tokenStr) return null;
  const dot = tokenStr.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = tokenStr.slice(0, dot);
  const sig = tokenStr.slice(dot + 1);
  try {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64').toString());
    return parsed.emp || null;
  } catch {
    return null;
  }
}

module.exports = { createEmpToken, verifyEmpToken, getCookieValue, readBody };
