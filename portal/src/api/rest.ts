import type { SessionListItem, Session, UnattendedAgentInfo } from '../../../packages/shared/src';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

export async function listSessions(): Promise<SessionListItem[]> {
  return request<SessionListItem[]>('/sessions');
}

export async function getSession(code: string): Promise<Session> {
  return request<Session>(`/sessions/${code}`);
}

export async function createSession(): Promise<{ code: string }> {
  return request<{ code: string }>('/sessions', { method: 'POST' });
}

export async function endSession(code: string): Promise<void> {
  await request<void>(`/sessions/${code}/end`, { method: 'POST' });
}

export async function listUnattendedAgents(): Promise<UnattendedAgentInfo[]> {
  const data = await request<{ agents: UnattendedAgentInfo[] }>('/agents');
  return data.agents;
}
