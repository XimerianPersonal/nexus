import http from 'http';
import express from 'express';
import cors from 'cors';
import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import config from './config';
import apiRoutes from './api/routes';
import { authenticateWsUpgrade } from './auth/middleware';
import { handleConnection, getContext } from './ws/handler';
import { startHeartbeat } from './ws/heartbeat';
import { handleDisconnect } from './session/manager';
import { sessionStore } from './session/store';

const SESSION_PURGE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_PURGE_MAX_AGE_MS = 60 * 60 * 1000;  // 1 hour

/**
 * Create and configure the HTTP server, Express app, and WebSocket server.
 */
export function createServer() {
  const app = express();

  // --- Middleware ---
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());

  // --- REST API routes ---
  app.use('/api', apiRoutes);

  // --- HTTP server ---
  const server = http.createServer(app);

  // --- WebSocket server ---
  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade -> WebSocket
  server.on('upgrade', (req, socket, head) => {
    // Check that the upgrade is for the /ws path
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Authenticate (optional for MVP -- if no token, assign a temporary ID)
    const auth = authenticateWsUpgrade(req);
    const clientId = auth?.sub || uuidv4();

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, clientId);
    });
  });

  // Handle new WebSocket connections
  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, clientId: string) => {
    handleConnection(ws, clientId);
  });

  // --- Heartbeat ---
  const stopHeartbeat = startHeartbeat(wss, getContext, (ws, ctx) => {
    handleDisconnect(ctx);
  });

  // --- Periodic session purge ---
  const purgeInterval = setInterval(() => {
    const purged = sessionStore.purgeEnded(SESSION_PURGE_MAX_AGE_MS);
    if (purged > 0) {
      console.log(`[server] Purged ${purged} ended session(s)`);
    }
  }, SESSION_PURGE_INTERVAL_MS);

  // --- Graceful shutdown ---
  function shutdown() {
    console.log('[server] Shutting down...');
    stopHeartbeat();
    clearInterval(purgeInterval);

    wss.clients.forEach((ws) => {
      ws.close(1001, 'Server shutting down');
    });

    wss.close(() => {
      server.close(() => {
        console.log('[server] Shutdown complete');
        process.exit(0);
      });
    });

    // Force exit after 5 seconds
    setTimeout(() => {
      console.error('[server] Forced shutdown after timeout');
      process.exit(1);
    }, 5000);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { app, server, wss };
}
