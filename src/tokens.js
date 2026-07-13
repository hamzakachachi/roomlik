const { createHmac, timingSafeEqual } = require('node:crypto');

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function signRoomToken(roomId, secret, lifetimeSeconds = 24 * 60 * 60) {
  const payload = encode(JSON.stringify({
    roomId,
    expiresAt: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  }));
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyRoomToken(token, secret) {
  if (typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let received;

  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.roomId || parsed.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

module.exports = { signRoomToken, verifyRoomToken };

