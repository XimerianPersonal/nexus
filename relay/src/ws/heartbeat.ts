import type WebSocket from 'ws';
import type { WebSocketServer } from 'ws';
import { WS_HEARTBEAT_INTERVAL_MS, WS_HEARTBEAT_TIMEOUT_MS } from '../../../packages/shared/src';
import { type ClientContext } from './handler';

const ALIVE_KEY = Symbol('alive');

interface HeartbeatSocket extends WebSocket {
  [ALIVE_KEY]?: boolean;
}

/**
 * Mark a socket as alive (called when we receive any message or pong).
 */
export function markAlive(ws: WebSocket): void {
  (ws as HeartbeatSocket)[ALIVE_KEY] = true;
}

/**
 * Start the heartbeat interval for a WebSocket server.
 * Pings all connected clients; terminates any that haven't responded
 * since the last ping cycle.
 *
 * Returns a cleanup function to stop the interval.
 */
export function startHeartbeat(
  wss: WebSocketServer,
  getContext: (ws: WebSocket) => ClientContext | undefined,
  onDead: (ws: WebSocket, ctx: ClientContext) => void
): () => void {
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const hws = ws as HeartbeatSocket;
      const ctx = getContext(ws);

      if (hws[ALIVE_KEY] === false) {
        // Client didn't respond to the last ping -- consider it dead
        console.log(`[heartbeat] Client timed out${ctx?.sessionCode ? ` (session ${ctx.sessionCode})` : ''}`);
        if (ctx) onDead(ws, ctx);
        ws.terminate();
        return;
      }

      // Mark as not-alive; if we get a pong before next cycle it will be set back
      hws[ALIVE_KEY] = false;
      ws.ping();
    });
  }, WS_HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(interval);
}
