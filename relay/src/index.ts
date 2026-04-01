import config from './config';
import { createServer } from './server';

const { server } = createServer();

server.listen(config.port, () => {
  console.log(`[nexus-relay] Relay server listening on port ${config.port}`);
  console.log(`[nexus-relay] WebSocket endpoint: ws://localhost:${config.port}/ws`);
  console.log(`[nexus-relay] Health check: http://localhost:${config.port}/api/health`);
  console.log(`[nexus-relay] Log level: ${config.logLevel}`);
});
