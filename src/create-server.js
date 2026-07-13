const path = require('node:path');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const express = require('express');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { RoomStore } = require('./room-store');
const { signRoomToken, verifyRoomToken } = require('./tokens');

const NAME_LIMIT = 60;
const DESCRIPTION_LIMIT = 180;
const PASSWORD_MIN = 4;
const PASSWORD_MAX = 72;

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateRoomInput(body, partial = false) {
  const errors = {};
  const result = {};

  if (!partial || Object.hasOwn(body, 'name')) {
    result.name = cleanString(body.name);
    if (!result.name) errors.name = 'Give your room a name.';
    else if (result.name.length > NAME_LIMIT) errors.name = `Use ${NAME_LIMIT} characters or fewer.`;
  }

  if (!partial || Object.hasOwn(body, 'description')) {
    result.description = cleanString(body.description);
    if (result.description.length > DESCRIPTION_LIMIT) {
      errors.description = `Use ${DESCRIPTION_LIMIT} characters or fewer.`;
    }
  }

  if (!partial || Object.hasOwn(body, 'password')) {
    result.password = typeof body.password === 'string' ? body.password : '';
    if (result.password.length < PASSWORD_MIN) errors.password = `Use at least ${PASSWORD_MIN} characters.`;
    else if (result.password.length > PASSWORD_MAX) errors.password = `Use ${PASSWORD_MAX} characters or fewer.`;
  }

  if (partial && Object.keys(result).length === 0) {
    errors.room = 'Provide a name, description, or new password.';
  }

  return { result, errors, valid: Object.keys(errors).length === 0 };
}

function createApplication(options = {}) {
  const dataFile = options.dataFile || path.join(__dirname, '..', 'data', 'rooms.json');
  const tokenSecret = options.tokenSecret || process.env.TOKEN_SECRET || randomBytes(32).toString('hex');
  const publicDirectory = path.join(__dirname, '..', 'public');
  const store = new RoomStore(dataFile);
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 100_000,
    serveClient: true,
  });

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        mediaSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
  }));
  app.use(express.json({ limit: '20kb' }));

  function participantCount(roomId) {
    return io.sockets.adapter.rooms.get(roomId)?.size || 0;
  }

  function issueToken(roomId) {
    return signRoomToken(roomId, tokenSecret);
  }

  function authenticateRoom(req, res, next) {
    const authorization = req.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const payload = verifyRoomToken(token, tokenSecret);

    if (!payload || payload.roomId !== req.params.id) {
      return res.status(401).json({ error: 'Unlock this room again to continue.' });
    }

    req.roomToken = token;
    return next();
  }

  app.get('/api/rooms', (req, res) => {
    const rooms = store.list().map((room) => ({
      ...room,
      participants: participantCount(room.id),
    }));
    res.json({ rooms });
  });

  app.get('/api/rooms/:id', (req, res) => {
    const room = store.get(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    return res.json({
      room: {
        ...RoomStorePublic(room),
        participants: participantCount(room.id),
      },
    });
  });

  app.post('/api/rooms', async (req, res, next) => {
    try {
      const validation = validateRoomInput(req.body || {});
      if (!validation.valid) return res.status(400).json({ error: 'Check the highlighted fields.', fields: validation.errors });

      const passwordHash = await bcrypt.hash(validation.result.password, 12);
      const room = store.create({
        name: validation.result.name,
        description: validation.result.description,
        passwordHash,
      });

      return res.status(201).json({ room: { ...room, participants: 0 }, token: issueToken(room.id) });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/rooms/:id/access', async (req, res, next) => {
    try {
      const room = store.get(req.params.id);
      if (!room) return res.status(404).json({ error: 'Room not found.' });

      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const allowed = password.length <= PASSWORD_MAX && await bcrypt.compare(password, room.passwordHash);
      if (!allowed) return res.status(401).json({ error: 'That password is not correct.' });

      return res.json({
        room: { ...RoomStorePublic(room), participants: participantCount(room.id) },
        token: issueToken(room.id),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/api/rooms/:id', authenticateRoom, async (req, res, next) => {
    try {
      if (!store.get(req.params.id)) return res.status(404).json({ error: 'Room not found.' });

      const validation = validateRoomInput(req.body || {}, true);
      if (!validation.valid) return res.status(400).json({ error: 'Check the highlighted fields.', fields: validation.errors });

      const changes = { ...validation.result };
      if (Object.hasOwn(changes, 'password')) {
        changes.passwordHash = await bcrypt.hash(changes.password, 12);
        delete changes.password;
      }

      const room = store.update(req.params.id, changes);
      return res.json({
        room: { ...room, participants: participantCount(room.id) },
        token: Object.hasOwn(changes, 'passwordHash') ? issueToken(room.id) : req.roomToken,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/rooms/:id', authenticateRoom, (req, res) => {
    if (!store.delete(req.params.id)) return res.status(404).json({ error: 'Room not found.' });

    io.to(req.params.id).emit('room-deleted');
    io.in(req.params.id).disconnectSockets(true);
    return res.status(204).end();
  });

  io.use((socket, next) => {
    const roomId = cleanString(socket.handshake.auth?.roomId);
    const payload = verifyRoomToken(socket.handshake.auth?.token, tokenSecret);
    const room = roomId ? store.get(roomId) : null;

    if (!room || !payload || payload.roomId !== roomId) {
      return next(new Error('This room needs to be unlocked again.'));
    }

    if (participantCount(roomId) >= 2) {
      return next(new Error('This room already has two people.'));
    }

    socket.data.roomId = roomId;
    return next();
  });

  io.on('connection', (socket) => {
    const roomId = socket.data.roomId;
    socket.join(roomId);

    io.to(roomId).emit('participant-count', participantCount(roomId));
    socket.to(roomId).emit('peer-joined');

    socket.on('signal', (message) => {
      if (!message || typeof message !== 'object') return;
      if (!['offer', 'answer', 'ice-candidate'].includes(message.type)) return;
      socket.to(roomId).emit('signal', message);
    });

    socket.on('disconnect', () => {
      socket.to(roomId).emit('peer-left');
      io.to(roomId).emit('participant-count', participantCount(roomId));
    });
  });

  app.use(express.static(publicDirectory, { extensions: ['html'] }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(publicDirectory, 'index.html'));
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return { app, httpServer, io, store };
}

function RoomStorePublic(room) {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

module.exports = { createApplication, validateRoomInput };
