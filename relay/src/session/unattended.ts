import type WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { sessionStore } from '../session/store';
import { generateSessionCode } from '../session/codes';
import { sendMessage, type ClientContext } from '../ws/handler';
import type {
  UnattendedRegisterMessage,
  UnattendedConnectMessage,
  UnattendedResponseMessage,
  UnattendedRegisteredMessage,
  UnattendedAccessRequestMessage,
  UnattendedAccessResultMessage,
  UnattendedAgentListMessage,
  UnattendedAgentInfo,
  SetAgentTagsMessage,
  GroupListMessage,
  GroupInfo,
  ErrorMessage,
  AgentInfo,
  PortalInfo,
  SessionCreatedMessage,
  PeerJoinedMessage,
} from '../../../packages/shared/src';
import { UNATTENDED_ACCESS_TIMEOUT_MS } from '../../../packages/shared/src';

// --- In-memory stores ---

interface RegisteredAgent {
  agentId: string;
  accessKeyHash: string;
  hostname: string;
  os: string;
  username: string;
  timeoutMs: number;
  tags: string[];
  ws: WebSocket | null;
  online: boolean;
  registeredAt: number;
  lastSeenAt: number;
  ctx: ClientContext | null;
}

interface PendingRequest {
  requestId: string;
  agentId: string;
  portalWs: WebSocket;
  portalCtx: ClientContext;
  portalDisplayName: string;
  createdAt: number;
  timeoutMs: number;
  timer: ReturnType<typeof setTimeout>;
  status: 'pending' | 'granted' | 'declined';
}

const registeredAgents = new Map<string, RegisteredAgent>();
const pendingRequests = new Map<string, PendingRequest>();

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Handle an agent registering for unattended access.
 */
export function handleUnattendedRegister(
  ws: WebSocket,
  msg: UnattendedRegisterMessage,
  ctx: ClientContext,
): void {
  const { agentId, accessKey, hostname, os, username, timeoutMs, tags } = msg;

  if (!agentId || !accessKey) {
    sendMessage(ws, {
      type: 'error',
      code: 'INVALID_UNATTENDED_REGISTER',
      message: 'agentId and accessKey are required.',
    } satisfies ErrorMessage);
    return;
  }

  const existing = registeredAgents.get(agentId);
  const keyHash = hashKey(accessKey);

  if (existing) {
    // Re-registering: verify the access key matches
    if (existing.accessKeyHash !== keyHash) {
      sendMessage(ws, {
        type: 'error',
        code: 'ACCESS_KEY_MISMATCH',
        message: 'Access key does not match the registered agent.',
      } satisfies ErrorMessage);
      return;
    }

    // Update connection
    existing.ws = ws;
    existing.online = true;
    existing.lastSeenAt = Date.now();
    existing.hostname = hostname;
    existing.os = os;
    existing.username = username;
    existing.ctx = ctx;
    if (timeoutMs) existing.timeoutMs = timeoutMs;
    if (tags) existing.tags = normalizeTags(tags);
  } else {
    // New registration
    registeredAgents.set(agentId, {
      agentId,
      accessKeyHash: keyHash,
      hostname,
      os,
      username,
      timeoutMs: timeoutMs || UNATTENDED_ACCESS_TIMEOUT_MS,
      tags: normalizeTags(tags || []),
      ws,
      online: true,
      registeredAt: Date.now(),
      lastSeenAt: Date.now(),
      ctx,
    });
  }

  ctx.role = 'agent';
  ctx.agentId = agentId;
  ctx.isUnattended = true;

  sendMessage(ws, {
    type: 'unattended_registered',
    agentId,
  } satisfies UnattendedRegisteredMessage);

  console.log(`[unattended] Agent "${agentId}" (${hostname}) registered for unattended access`);
}

/**
 * Handle a portal requesting unattended access to an agent.
 */
export function handleUnattendedConnect(
  ws: WebSocket,
  msg: UnattendedConnectMessage,
  ctx: ClientContext,
): void {
  const { agentId, accessKey, displayName } = msg;

  const agent = registeredAgents.get(agentId);
  if (!agent) {
    sendMessage(ws, {
      type: 'unattended_access_result',
      agentId,
      granted: false,
      reason: 'Agent not found.',
    } satisfies UnattendedAccessResultMessage);
    return;
  }

  // Verify access key
  if (agent.accessKeyHash !== hashKey(accessKey)) {
    sendMessage(ws, {
      type: 'unattended_access_result',
      agentId,
      granted: false,
      reason: 'Invalid access key.',
    } satisfies UnattendedAccessResultMessage);
    return;
  }

  if (!agent.online || !agent.ws || agent.ws.readyState !== 1) {
    sendMessage(ws, {
      type: 'unattended_access_result',
      agentId,
      granted: false,
      reason: 'Agent is offline.',
    } satisfies UnattendedAccessResultMessage);
    return;
  }

  // Create a pending request
  const requestId = uuidv4();
  const portalDisplayName = displayName || 'Support Agent';
  const timeoutMs = agent.timeoutMs;

  // Set up auto-accept timer: if user doesn't decline within timeout, grant access
  const timer = setTimeout(() => {
    grantAccess(requestId);
  }, timeoutMs);

  const request: PendingRequest = {
    requestId,
    agentId,
    portalWs: ws,
    portalCtx: ctx,
    portalDisplayName,
    createdAt: Date.now(),
    timeoutMs,
    timer,
    status: 'pending',
  };

  pendingRequests.set(requestId, request);

  // Notify the agent: "Someone wants to connect, you have X seconds to decline"
  sendMessage(agent.ws, {
    type: 'unattended_access_request',
    requestId,
    displayName: portalDisplayName,
    timeoutMs,
  } satisfies UnattendedAccessRequestMessage);

  console.log(
    `[unattended] Access request ${requestId}: "${portalDisplayName}" -> agent "${agentId}" (${timeoutMs / 1000}s timeout)`,
  );
}

/**
 * Handle the agent user declining an unattended access request.
 */
export function handleUnattendedResponse(
  ws: WebSocket,
  msg: UnattendedResponseMessage,
  ctx: ClientContext,
): void {
  const request = pendingRequests.get(msg.requestId);

  if (!request) {
    sendMessage(ws, {
      type: 'error',
      code: 'REQUEST_NOT_FOUND',
      message: 'Access request not found or already resolved.',
    } satisfies ErrorMessage);
    return;
  }

  if (request.status !== 'pending') return;

  if (msg.action === 'decline') {
    request.status = 'declined';
    clearTimeout(request.timer);
    pendingRequests.delete(msg.requestId);

    // Notify the portal
    if (request.portalWs.readyState === 1) {
      sendMessage(request.portalWs, {
        type: 'unattended_access_result',
        agentId: request.agentId,
        granted: false,
        reason: 'Access was declined by the user.',
      } satisfies UnattendedAccessResultMessage);
    }

    console.log(`[unattended] Request ${msg.requestId} declined by user`);
  }
}

/**
 * Grant access: create a session and connect agent + portal.
 */
function grantAccess(requestId: string): void {
  const request = pendingRequests.get(requestId);
  if (!request || request.status !== 'pending') return;

  request.status = 'granted';
  clearTimeout(request.timer);
  pendingRequests.delete(requestId);

  const agent = registeredAgents.get(request.agentId);
  if (!agent || !agent.ws || agent.ws.readyState !== 1) {
    if (request.portalWs.readyState === 1) {
      sendMessage(request.portalWs, {
        type: 'unattended_access_result',
        agentId: request.agentId,
        granted: false,
        reason: 'Agent went offline during request.',
      } satisfies UnattendedAccessResultMessage);
    }
    return;
  }

  // Generate session code and create session
  let code: string | null = null;
  for (let i = 0; i < 20; i++) {
    const candidate = generateSessionCode();
    if (!sessionStore.has(candidate)) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    sendMessage(request.portalWs, {
      type: 'unattended_access_result',
      agentId: request.agentId,
      granted: false,
      reason: 'Failed to generate session code.',
    } satisfies UnattendedAccessResultMessage);
    return;
  }

  // Create the session
  sessionStore.create(code);

  const agentInfo: AgentInfo = {
    hostname: agent.hostname,
    os: agent.os,
    username: agent.username,
    connectedAt: Date.now(),
  };
  sessionStore.setAgent(code, agent.ws, agentInfo);

  // Update agent context
  if (agent.ctx) {
    agent.ctx.sessionCode = code;
  }

  // Notify agent of the new session
  sendMessage(agent.ws, {
    type: 'session_created',
    sessionCode: code,
  } satisfies SessionCreatedMessage);

  // Set up portal side
  const portalInfo: PortalInfo = {
    displayName: request.portalDisplayName,
    connectedAt: Date.now(),
  };
  sessionStore.setPortal(code, request.portalWs, portalInfo);

  request.portalCtx.role = 'portal';
  request.portalCtx.sessionCode = code;

  // Notify portal of granted access
  sendMessage(request.portalWs, {
    type: 'unattended_access_result',
    agentId: request.agentId,
    granted: true,
    sessionCode: code,
  } satisfies UnattendedAccessResultMessage);

  // Notify both sides of peer joined
  sendMessage(agent.ws, {
    type: 'peer_joined',
    sessionCode: code,
    role: 'portal',
    displayName: request.portalDisplayName,
  } satisfies PeerJoinedMessage);

  sendMessage(request.portalWs, {
    type: 'peer_joined',
    sessionCode: code,
    role: 'agent',
  } satisfies PeerJoinedMessage);

  console.log(
    `[unattended] Access granted: session ${code} created for agent "${request.agentId}" <-> "${request.portalDisplayName}"`,
  );
}

/**
 * Handle agent disconnect for unattended agents.
 */
export function handleUnattendedDisconnect(ctx: ClientContext): void {
  if (!ctx.agentId) return;

  const agent = registeredAgents.get(ctx.agentId);
  if (agent) {
    agent.ws = null;
    agent.online = false;
    agent.lastSeenAt = Date.now();
    agent.ctx = null;

    // Cancel any pending requests for this agent
    for (const [id, request] of pendingRequests) {
      if (request.agentId === ctx.agentId && request.status === 'pending') {
        request.status = 'declined';
        clearTimeout(request.timer);
        pendingRequests.delete(id);

        if (request.portalWs.readyState === 1) {
          sendMessage(request.portalWs, {
            type: 'unattended_access_result',
            agentId: request.agentId,
            granted: false,
            reason: 'Agent disconnected.',
          } satisfies UnattendedAccessResultMessage);
        }
      }
    }
  }

  console.log(`[unattended] Agent "${ctx.agentId}" disconnected`);
}

/**
 * Send the list of registered unattended agents to a portal.
 */
export function sendAgentList(ws: WebSocket): void {
  sendMessage(ws, {
    type: 'unattended_agent_list',
    agents: getRegisteredAgents(),
  } satisfies UnattendedAgentListMessage);
}

/**
 * Get the list of registered agents for the REST API.
 */
export function getRegisteredAgents(): UnattendedAgentInfo[] {
  const agents: UnattendedAgentInfo[] = [];
  for (const agent of registeredAgents.values()) {
    agents.push({
      agentId: agent.agentId,
      hostname: agent.hostname,
      os: agent.os,
      username: agent.username,
      online: agent.online,
      lastSeen: agent.lastSeenAt,
      tags: agent.tags,
    });
  }
  return agents;
}

// --- Device Group / Tag Management ---

/** Normalize tags: lowercase, trim, deduplicate, sort */
function normalizeTags(tags: string[]): string[] {
  const set = new Set(
    tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0),
  );
  return [...set].sort();
}

/**
 * Handle portal setting tags on an agent.
 */
export function handleSetAgentTags(
  ws: WebSocket,
  msg: SetAgentTagsMessage,
  _ctx: ClientContext,
): void {
  const agent = registeredAgents.get(msg.agentId);
  if (!agent) {
    sendMessage(ws, {
      type: 'error',
      code: 'AGENT_NOT_FOUND',
      message: `Agent "${msg.agentId}" not found.`,
    } satisfies ErrorMessage);
    return;
  }

  agent.tags = normalizeTags(msg.tags);
  console.log(`[groups] Agent "${msg.agentId}" tags set to [${agent.tags.join(', ')}]`);

  // Send updated agent list back
  sendAgentList(ws);
}

/**
 * Handle portal requesting the list of all groups.
 */
export function handleListGroups(ws: WebSocket): void {
  sendMessage(ws, {
    type: 'group_list',
    groups: getGroups(),
  } satisfies GroupListMessage);
}

/**
 * Compute the list of all groups from agent tags.
 */
export function getGroups(): GroupInfo[] {
  const groupMap = new Map<string, { total: number; online: number }>();

  for (const agent of registeredAgents.values()) {
    for (const tag of agent.tags) {
      const entry = groupMap.get(tag) || { total: 0, online: 0 };
      entry.total++;
      if (agent.online) entry.online++;
      groupMap.set(tag, entry);
    }
  }

  const groups: GroupInfo[] = [];
  for (const [name, counts] of groupMap) {
    groups.push({
      name,
      agentCount: counts.total,
      onlineCount: counts.online,
    });
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name));
}
