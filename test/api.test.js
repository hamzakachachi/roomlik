const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApplication } = require('../src/create-server');

let baseUrl;
let httpServer;
let temporaryDirectory;

before(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'roomly-test-'));
  const application = createApplication({
    dataFile: path.join(temporaryDirectory, 'rooms.json'),
    tokenSecret: 'test-secret-that-is-long-enough',
  });
  httpServer = application.httpServer;
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

test('validates room creation input', async () => {
  const { response, body } = await request('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ name: '', description: '', password: '123' }),
  });

  assert.equal(response.status, 400);
  assert.equal(body.fields.name, 'Give your room a name.');
  assert.match(body.fields.password, /at least 4/i);
});

test('supports the protected room CRUD lifecycle', async () => {
  const created = await request('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Design catch-up',
      description: 'A private weekly call',
      password: 'correct horse',
    }),
  });

  assert.equal(created.response.status, 201);
  assert.ok(created.body.room.id);
  assert.ok(created.body.token);
  assert.equal(created.body.room.passwordHash, undefined);
  const roomId = created.body.room.id;

  const listed = await request('/api/rooms');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.rooms.length, 1);
  assert.equal(listed.body.rooms[0].participants, 0);

  const rejected = await request(`/api/rooms/${roomId}/access`, {
    method: 'POST',
    body: JSON.stringify({ password: 'wrong password' }),
  });
  assert.equal(rejected.response.status, 401);

  const unlocked = await request(`/api/rooms/${roomId}/access`, {
    method: 'POST',
    body: JSON.stringify({ password: 'correct horse' }),
  });
  assert.equal(unlocked.response.status, 200);
  assert.ok(unlocked.body.token);

  const unauthorisedUpdate = await request(`/api/rooms/${roomId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Changed' }),
  });
  assert.equal(unauthorisedUpdate.response.status, 401);

  const updated = await request(`/api/rooms/${roomId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${unlocked.body.token}` },
    body: JSON.stringify({ name: 'Monday catch-up', password: 'new password' }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.room.name, 'Monday catch-up');
  assert.ok(updated.body.token);

  const oldPassword = await request(`/api/rooms/${roomId}/access`, {
    method: 'POST',
    body: JSON.stringify({ password: 'correct horse' }),
  });
  assert.equal(oldPassword.response.status, 401);

  const removed = await request(`/api/rooms/${roomId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${updated.body.token}` },
  });
  assert.equal(removed.response.status, 204);

  const missing = await request(`/api/rooms/${roomId}`);
  assert.equal(missing.response.status, 404);
});

