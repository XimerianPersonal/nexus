import type WebSocket from 'ws';
import type { ClientMessage, ChatMessage, FileOfferMessage, FileAcceptMessage, ErrorMessage } from '../../../packages/shared/src';
import { handleRegister, handleJoinSession } from '../session/manager';
import { handleSignal } from '../signaling/webrtc';
import {
  handleUnattendedRegister,
  handleUnattendedConnect,
  handleUnattendedResponse,
  handleSetAgentTags,
  handleListGroups,
  sendAgentList,
} from '../session/unattended';
import { sendMessage, type ClientContext } from './handler';
import { sessionStore } from '../session/store';

/**
 * Route an incoming client message to the appropriate handler.
 */
export function routeMessage(ws: WebSocket, msg: ClientMessage, ctx: ClientContext): void {
  switch (msg.type) {
    case 'register':
      handleRegister(ws, msg, ctx);
      break;

    case 'join_session':
      handleJoinSession(ws, msg, ctx);
      break;

    case 'signal':
      handleSignal(ws, msg, ctx);
      break;

    case 'chat':
      relayToPeer(ws, msg, ctx);
      break;

    case 'file_offer':
      relayToPeer(ws, msg, ctx);
      break;

    case 'file_accept':
      relayToPeer(ws, msg, ctx);
      break;

    case 'heartbeat':
      sendMessage(ws, { type: 'heartbeat_ack' });
      break;

    // --- Unattended Access ---
    case 'unattended_register':
      handleUnattendedRegister(ws, msg, ctx);
      break;

    case 'unattended_connect':
      handleUnattendedConnect(ws, msg, ctx);
      break;

    case 'unattended_response':
      handleUnattendedResponse(ws, msg, ctx);
      break;

    // --- Device Groups ---
    case 'set_agent_tags':
      handleSetAgentTags(ws, msg, ctx);
      break;

    case 'list_groups':
      handleListGroups(ws);
      break;

    default: {
      sendMessage(ws, {
        type: 'error',
        code: 'UNKNOWN_MESSAGE',
        message: `Unknown message type: ${(msg as any).type}`,
      } satisfies ErrorMessage);
    }
  }
}

/**
 * Relay a message (chat, file_offer, file_accept) to the peer in the same session.
 */
function relayToPeer(
  ws: WebSocket,
  msg: ChatMessage | FileOfferMessage | FileAcceptMessage,
  ctx: ClientContext
): void {
  const session = sessionStore.get(msg.sessionCode);

  if (!session) {
    sendMessage(ws, {
      type: 'error',
      code: 'SESSION_NOT_FOUND',
      message: 'Session not found.',
    } satisfies ErrorMessage);
    return;
  }

  if (!ctx.role || ctx.sessionCode !== msg.sessionCode) {
    sendMessage(ws, {
      type: 'error',
      code: 'NOT_IN_SESSION',
      message: 'You are not a participant in this session.',
    } satisfies ErrorMessage);
    return;
  }

  const peerWs = ctx.role === 'agent' ? session.portalWs : session.agentWs;

  if (!peerWs || peerWs.readyState !== 1 /* WebSocket.OPEN */) {
    sendMessage(ws, {
      type: 'error',
      code: 'PEER_NOT_CONNECTED',
      message: 'Peer is not connected.',
    } satisfies ErrorMessage);
    return;
  }

  sendMessage(peerWs, msg);
}
