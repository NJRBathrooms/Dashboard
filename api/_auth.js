const crypto = require('crypto');

function createToken(secret) {
  const payload = Buffer.from(JSON.stringify({ ok: true, iat: Date.now() })).toString('base64');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return payload + '.' + sig;
}

function verifyToken(tokenStr, secret) {
  if (!tokenStr) return false;
  const dot = tokenStr.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = tokenStr.slice(0, dot);
  const sig = tokenStr.slice(dot + 1);
  try {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (e) {
    return false;
  }
}

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const found = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return found ? found.slice(name.length + 1) : null;
}

// Read and parse JSON body from a Node.js IncomingMessage stream
async function readBody(req) {
  // Some Vercel configurations already parse the body
  if (req.body !== undefined) {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  }
  // Fall back to async stream reading
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString();
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}

module.exports = { createToken, verifyToken, getCookieValue, readBody };
