const test = require('node:test');
const assert = require('node:assert/strict');
const { signRoomToken, verifyRoomToken } = require('../src/tokens');

test('signs and verifies a room-scoped token', () => {
  const token = signRoomToken('room-123', 'secret');
  const payload = verifyRoomToken(token, 'secret');
  assert.equal(payload.roomId, 'room-123');
});

test('rejects tampered and expired tokens', () => {
  const token = signRoomToken('room-123', 'secret');
  assert.equal(verifyRoomToken(`${token}x`, 'secret'), null);

  const expired = signRoomToken('room-123', 'secret', -1);
  assert.equal(verifyRoomToken(expired, 'secret'), null);
});

