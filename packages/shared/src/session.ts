import type { ClientRole } from './messages';

export type SessionStatus = 'waiting' | 'connected' | 'paused' | 'ended';

export interface Session {
  code: string;
  status: SessionStatus;
  agentInfo?: AgentInfo;
  portalInfo?: PortalInfo;
  createdAt: number;
  connectedAt?: number;
  endedAt?: number;
}

export interface AgentInfo {
  hostname: string;
  os: string;
  username: string;
  connectedAt: number;
}

export interface PortalInfo {
  displayName: string;
  connectedAt: number;
}

export interface SessionListItem {
  code: string;
  status: SessionStatus;
  hostname?: string;
  os?: string;
  username?: string;
  connectedAt?: number;
  duration?: number;
  unattended?: boolean;
}

// --- Unattended Access ---

export interface UnattendedAgent {
  agentId: string;
  hostname: string;
  os: string;
  username: string;
  accessKeyHash: string;
  timeoutMs: number;
  registeredAt: number;
  lastSeenAt: number;
  online: boolean;
}

export interface UnattendedAccessRequest {
  requestId: string;
  agentId: string;
  portalDisplayName: string;
  createdAt: number;
  timeoutMs: number;
  status: 'pending' | 'granted' | 'declined' | 'expired';
}
