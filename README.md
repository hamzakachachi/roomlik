# Roomly

Roomly is a small full-stack Node.js app for private, two-person video calls. Rooms can be created, viewed, edited, and deleted; every room is protected by a hashed password.

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Camera access works on `localhost`; a deployed version must use HTTPS.

## How it works

- Express serves the REST API and static browser client.
- Room metadata is stored in `data/rooms.json`; it is created automatically and excluded from Git.
- Passwords use bcrypt and are never returned by the API.
- Unlocking a room issues a signed, room-scoped token used for updates, deletion, and Socket.IO access.
- Socket.IO relays WebRTC offers, answers, and ICE candidates. Media flows directly between the two browsers.
- A room rejects a third signaling connection.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `3000` |
| `DATA_FILE` | Room JSON storage path | `data/rooms.json` |
| `TOKEN_SECRET` | Secret used to sign room access tokens | Random per server start |

Set a stable, strong `TOKEN_SECRET` in production so access tokens remain valid across restarts. For reliable calls across strict corporate or mobile networks, add your own TURN server to `rtcConfiguration` in `public/app.js`.

## Checks

```bash
npm run check
npm test
```

## Deploy with Docker Compose

Copy the example environment file and replace the signing secret with a strong random value:

```bash
cp .env.example .env
openssl rand -hex 32
```

Put the generated value after `TOKEN_SECRET=` in `.env`, then build and start the service:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f roomly
```

The app is available on port `3000` by default. Change `APP_PORT` in `.env` if the VPS should publish a different port. Room records persist in the `roomly_data` named volume, including across container rebuilds.

For a public VPS, place Caddy, Nginx, or another HTTPS reverse proxy in front of `localhost:3000`. Browsers require HTTPS for camera and microphone access outside `localhost`, and the proxy must pass WebSocket upgrade headers for Socket.IO.

Useful deployment commands:

```bash
# Pull your latest source and recreate the app
docker compose up -d --build

# View health and status
docker compose ps

# Stop without deleting room data
docker compose down

# Back up the persistent room database
docker compose exec roomly cat /app/data/rooms.json > rooms-backup.json
```

Do not run `docker compose down -v` unless you intend to permanently delete all stored rooms.
