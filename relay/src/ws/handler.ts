import type WebSocket from 'ws';
import type { ClientRole, ClientMessage, ServerMessage } from '../../../packages/shared/src';
import { routeMessage } from './router';
import { markAlive } from './heartbeat';
import { handleDisconnect } from '../session/manager';
import { handleUnattendedDisconnect } from '../session/unattended';

/**
 * Per-connection context attached to each WebSocket client.
 * Tracks the client's role and which session they belong to.
 */
export interface ClientContext {
  clientId: string;
  role: ClientRole | null;
  sessionCode: string | null;
  connectedAt: number;
  agentId?: string;          // For unattended agents: persistent agent ID
  isUnattended?: boolean;    // Whether this is an unattended agent connection
}

/** WeakMap of all active client contexts, keyed by their WebSocket. */
const contexts = new WeakMap<WebSocket, ClientContext>();

/**
 * Get the context for a WebSocket, if any.
 */
export function getContext(ws: WebSocket): ClientContext | undefined {
  return contexts.get(ws);
}

/**
 * Send a typed server message over a WebSocket.
 */
export function sendMessage(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Handle a new WebSocket connection.
 * Sets up the per-connection context, message parsing, and cleanup on close.
 */
export function handleConnection(ws: WebSocket, clientId: string): void {
  const ctx: ClientContext = {
    clientId,
    role: null,
    sessionCode: null,
    connectedAt: Date.now(),
  };

  contexts.set(ws, ctx);
  markAlive(ws);

  console.log(`[ws] Client connected: ${clientId}`);

  ws.on('message', (data: Buffer | string) => {
    markAlive(ws);

    let msg: ClientMessage;
    try {
      const raw = typeof data === 'string' ? data : data.toString('utf-8');
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      sendMessage(ws, {
        type: 'error',
        code: 'INVALID_JSON',
        message: 'Failed to parse message as JSON.',
      });
      return;
    }

    if (!msg || typeof msg.type !== 'string') {
      sendMessage(ws, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Message must have a "type" field.',
      });
      return;
    }

    try {
      routeMessage(ws, msg, ctx);
    } catch (err) {
      console.error(`[ws] Error handling message type "${msg.type}":`, err);
      sendMessage(ws, {
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred while processing your message.',
      });
    }
  });

  ws.on('pong', () => {
    markAlive(ws);
  });

  ws.on('close', (code, reason) => {
    console.log(
      `[ws] Client disconnected: ${clientId} (code=${code}, reason=${reason?.toString() || 'none'})`
    );
    if (ctx.isUnattended) {
      handleUnattendedDisconnect(ctx);
    }
    handleDisconnect(ctx);
    contexts.delete(ws);
  });

  ws.on('error', (err) => {
    console.error(`[ws] Socket error for ${clientId}:`, err.message);
  });
}
