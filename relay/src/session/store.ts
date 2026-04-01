import type WebSocket from 'ws';
import type { Session, SessionStatus, AgentInfo, PortalInfo, SessionListItem } from '../../../packages/shared/src';
import type { ClientRole } from '../../../packages/shared/src';

/** Internal session record that includes WS references. */
export interface SessionRecord extends Session {
  agentWs: WebSocket | null;
  portalWs: WebSocket | null;
}

/**
 * In-memory session store. Suitable for a single-instance relay.
 * For production scale-out, replace with Redis or similar.
 */
class SessionStore {
  private sessions = new Map<string, SessionRecord>();

  create(code: string): SessionRecord {
    const record: SessionRecord = {
      code,
      status: 'waiting',
      createdAt: Date.now(),
      agentWs: null,
      portalWs: null,
    };
    this.sessions.set(code, record);
    return record;
  }

  get(code: string): SessionRecord | undefined {
    return this.sessions.get(code);
  }

  has(code: string): boolean {
    return this.sessions.has(code);
  }

  setAgent(code: string, ws: WebSocket, info: AgentInfo): void {
    const session = this.sessions.get(code);
    if (!session) return;
    session.agentWs = ws;
    session.agentInfo = info;
  }

  setPortal(code: string, ws: WebSocket, info: PortalInfo): void {
    const session = this.sessions.get(code);
    if (!session) return;
    session.portalWs = ws;
    session.portalInfo = info;
    session.status = 'connected';
    session.connectedAt = Date.now();
  }

  updateStatus(code: string, status: SessionStatus): void {
    const session = this.sessions.get(code);
    if (!session) return;
    session.status = status;
    if (status === 'ended') {
      session.endedAt = Date.now();
    }
  }

  removeClient(code: string, role: ClientRole): void {
    const session = this.sessions.get(code);
    if (!session) return;
    if (role === 'agent') {
      session.agentWs = null;
    } else {
      session.portalWs = null;
    }
  }

  /**
   * Remove ended sessions older than the given max age (in ms).
   */
  purgeEnded(maxAgeMs: number = 60 * 60 * 1000): number {
    const now = Date.now();
    let purged = 0;
    for (const [code, session] of this.sessions) {
      if (session.status === 'ended' && session.endedAt && now - session.endedAt > maxAgeMs) {
        this.sessions.delete(code);
        purged++;
      }
    }
    return purged;
  }

  delete(code: string): boolean {
    return this.sessions.delete(code);
  }

  /** Return a list of all non-ended sessions for the REST API. */
  listActive(): SessionListItem[] {
    const items: SessionListItem[] = [];
    for (const session of this.sessions.values()) {
      if (session.status === 'ended') continue;
      const item: SessionListItem = {
        code: session.code,
        status: session.status,
        hostname: session.agentInfo?.hostname,
        os: session.agentInfo?.os,
        username: session.agentInfo?.username,
        connectedAt: session.connectedAt,
      };
      if (session.connectedAt) {
        item.duration = Date.now() - session.connectedAt;
      }
      items.push(item);
    }
    return items;
  }

  get size(): number {
    return this.sessions.size;
  }
}

export const sessionStore = new SessionStore();
