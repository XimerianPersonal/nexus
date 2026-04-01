import type WebSocket from 'ws';
import { sessionStore } from '../session/store';
import { sendMessage, type ClientContext } from '../ws/handler';
import type { SignalMessage, ErrorMessage } from '../../../packages/shared/src';

/**
 * Relay a WebRTC signaling message (SDP offer/answer or ICE candidate)
 * from one peer to the other within the same session.
 */
export function handleSignal(ws: WebSocket, msg: SignalMessage, ctx: ClientContext): void {
  const session = sessionStore.get(msg.sessionCode);

  if (!session) {
    sendMessage(ws, {
      type: 'error',
      code: 'SESSION_NOT_FOUND',
      message: 'Session not found for signaling.',
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

  // Determine the peer to forward to
  const peerWs = ctx.role === 'agent' ? session.portalWs : session.agentWs;

  if (!peerWs || peerWs.readyState !== 1 /* WebSocket.OPEN */) {
    sendMessage(ws, {
      type: 'error',
      code: 'PEER_NOT_CONNECTED',
      message: 'Peer is not connected.',
    } satisfies ErrorMessage);
    return;
  }

  // Forward the signal message as-is to the peer
  sendMessage(peerWs, msg);

  const signalKind = msg.signal.kind;
  console.log(`[signal] Relayed ${signalKind} from ${ctx.role} in session ${msg.sessionCode}`);
}
