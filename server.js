require('dotenv').config();

const path = require('node:path');
const { createApplication } = require('./src/create-server');

const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'rooms.json');
const { httpServer } = createApplication({ dataFile });

httpServer.listen(port, () => {
  console.log(`Roomlik is running at http://localhost:${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Closing Roomlik gracefully…`);
  httpServer.close(() => process.exit(0));

  setTimeout(() => process.exit(1), 9_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
