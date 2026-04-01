import type WebSocket from 'ws';
import { sessionStore, type SessionRecord } from './store';
import { generateSessionCode, isValidSessionCode } from './codes';
import type {
  ClientRole,
  RegisterMessage,
  JoinSessionMessage,
  SessionCreatedMessage,
  SessionJoinedMessage,
  PeerJoinedMessage,
  PeerLeftMessage,
  ErrorMessage,
  AgentInfo,
  PortalInfo,
} from '../../../packages/shared/src';
import { sendMessage, type ClientContext } from '../ws/handler';

const MAX_CODE_GENERATION_ATTEMPTS = 20;

/**
 * Handle a desktop agent registering: create a new session and return the code.
 */
export function handleRegister(ws: WebSocket, msg: RegisterMessage, ctx: ClientContext): void {
  // Generate a unique session code
  let code: string | null = null;
  for (let i = 0; i < MAX_CODE_GENERATION_ATTEMPTS; i++) {
    const candidate = generateSessionCode();
    if (!sessionStore.has(candidate)) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    sendMessage(ws, {
      type: 'error',
      code: 'CODE_GENERATION_FAILED',
      message: 'Failed to generate a unique session code. Please try again.',
    } satisfies ErrorMessage);
    return;
  }

  const session = sessionStore.create(code);

  const agentInfo: AgentInfo = {
    hostname: msg.hostname || 'unknown',
    os: msg.os || 'unknown',
    username: msg.username || 'unknown',
    connectedAt: Date.now(),
  };

  sessionStore.setAgent(code, ws, agentInfo);

  // Store session code on context so we can clean up on disconnect
  ctx.role = 'agent';
  ctx.sessionCode = code;

  sendMessage(ws, {
    type: 'session_created',
    sessionCode: code,
  } satisfies SessionCreatedMessage);

  console.log(`[session] Created session ${code} for agent ${agentInfo.hostname}`);
}

/**
 * Handle a portal (support agent) joining an existing session by code.
 */
export function handleJoinSession(ws: WebSocket, msg: JoinSessionMessage, ctx: ClientContext): void {
  const code = msg.sessionCode.toUpperCase();

  if (!isValidSessionCode(code)) {
    sendMessage(ws, {
      type: 'error',
      code: 'INVALID_CODE',
      message: 'Invalid session code format.',
    } satisfies ErrorMessage);
    return;
  }

  const session = sessionStore.get(code);
  if (!session) {
    sendMessage(ws, {
      type: 'error',
      code: 'SESSION_NOT_FOUND',
      message: 'No session found with that code.',
    } satisfies ErrorMessage);
    return;
  }

  if (session.status === 'ended') {
    sendMessage(ws, {
      type: 'error',
      code: 'SESSION_ENDED',
      message: 'That session has already ended.',
    } satisfies ErrorMessage);
    return;
  }

  if (msg.role === 'portal') {
    if (session.portalWs) {
      sendMessage(ws, {
        type: 'error',
        code: 'SESSION_FULL',
        message: 'A support agent is already connected to this session.',
      } satisfies ErrorMessage);
      return;
    }

    const portalInfo: PortalInfo = {
      displayName: msg.displayName || 'Support Agent',
      connectedAt: Date.now(),
    };

    sessionStore.setPortal(code, ws, portalInfo);

    ctx.role = 'portal';
    ctx.sessionCode = code;

    // Notify the joining portal
    sendMessage(ws, {
      type: 'session_joined',
      sessionCode: code,
      role: 'portal',
    } satisfies SessionJoinedMessage);

    // Notify the agent that a portal has joined
    if (session.agentWs && session.agentWs.readyState === ws.OPEN) {
      sendMessage(session.agentWs, {
        type: 'peer_joined',
        sessionCode: code,
        role: 'portal',
        displayName: portalInfo.displayName,
      } satisfies PeerJoinedMessage);
    }

    console.log(`[session] Portal "${portalInfo.displayName}" joined session ${code}`);
  } else if (msg.role === 'agent') {
    // Agent reconnecting to their own session
    if (session.agentWs && session.agentWs.readyState === ws.OPEN) {
      sendMessage(ws, {
        type: 'error',
        code: 'SESSION_FULL',
        message: 'An agent is already connected to this session.',
      } satisfies ErrorMessage);
      return;
    }

    const agentInfo: AgentInfo = {
      hostname: 'unknown',
      os: 'unknown',
      username: 'unknown',
      connectedAt: Date.now(),
    };

    sessionStore.setAgent(code, ws, agentInfo);

    ctx.role = 'agent';
    ctx.sessionCode = code;

    sendMessage(ws, {
      type: 'session_joined',
      sessionCode: code,
      role: 'agent',
    } satisfies SessionJoinedMessage);

    // Notify the portal that the agent reconnected
    if (session.portalWs && session.portalWs.readyState === ws.OPEN) {
      sendMessage(session.portalWs, {
        type: 'peer_joined',
        sessionCode: code,
        role: 'agent',
      } satisfies PeerJoinedMessage);
    }

    console.log(`[session] Agent reconnected to session ${code}`);
  }
}

/**
 * Handle a client disconnect: notify peer and update session state.
 */
export function handleDisconnect(ctx: ClientContext): void {
  if (!ctx.sessionCode || !ctx.role) return;

  const session = sessionStore.get(ctx.sessionCode);
  if (!session) return;

  const peerRole: ClientRole = ctx.role === 'agent' ? 'portal' : 'agent';
  const peerWs = ctx.role === 'agent' ? session.portalWs : session.agentWs;

  sessionStore.removeClient(ctx.sessionCode, ctx.role);

  // Notify the peer
  if (peerWs && peerWs.readyState === 1 /* WebSocket.OPEN */) {
    sendMessage(peerWs, {
      type: 'peer_left',
      sessionCode: ctx.sessionCode,
      role: ctx.role,
    } satisfies PeerLeftMessage);
  }

  // If the agent disconnects, end the session.
  // If the portal disconnects, the session goes back to waiting.
  if (ctx.role === 'agent') {
    sessionStore.updateStatus(ctx.sessionCode, 'ended');
    console.log(`[session] Agent disconnected, session ${ctx.sessionCode} ended`);
  } else {
    if (session.status === 'connected') {
      sessionStore.updateStatus(ctx.sessionCode, 'waiting');
      console.log(`[session] Portal disconnected from session ${ctx.sessionCode}, returning to waiting`);
    }
  }
}
