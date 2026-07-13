const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class RoomStore {
  constructor(dataFile) {
    this.dataFile = dataFile;
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });

    if (!fs.existsSync(dataFile)) {
      fs.writeFileSync(dataFile, '[]\n', { encoding: 'utf8', mode: 0o600 });
    }
  }

  _read() {
    const contents = fs.readFileSync(this.dataFile, 'utf8');
    const rooms = JSON.parse(contents);

    if (!Array.isArray(rooms)) {
      throw new Error('Room data file must contain an array.');
    }

    return rooms;
  }

  _write(rooms) {
    const temporaryFile = `${this.dataFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, `${JSON.stringify(rooms, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporaryFile, this.dataFile);
  }

  list() {
    return this._read()
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
      .map(RoomStore.toPublicRoom);
  }

  get(id) {
    return this._read().find((room) => room.id === id) || null;
  }

  create({ name, description, passwordHash }) {
    const rooms = this._read();
    const timestamp = new Date().toISOString();
    const room = {
      id: randomUUID(),
      name,
      description,
      passwordHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    rooms.push(room);
    this._write(rooms);
    return RoomStore.toPublicRoom(room);
  }

  update(id, changes) {
    const rooms = this._read();
    const index = rooms.findIndex((room) => room.id === id);

    if (index === -1) return null;

    rooms[index] = {
      ...rooms[index],
      ...changes,
      id: rooms[index].id,
      createdAt: rooms[index].createdAt,
      updatedAt: new Date().toISOString(),
    };

    this._write(rooms);
    return RoomStore.toPublicRoom(rooms[index]);
  }

  delete(id) {
    const rooms = this._read();
    const nextRooms = rooms.filter((room) => room.id !== id);

    if (nextRooms.length === rooms.length) return false;

    this._write(nextRooms);
    return true;
  }

  static toPublicRoom(room) {
    return {
      id: room.id,
      name: room.name,
      description: room.description,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  }
}

module.exports = { RoomStore };

