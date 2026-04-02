// ---- WebSocket Message Types ----

export type ClientRole = 'agent' | 'portal';

// Messages sent from clients to relay
export type ClientMessage =
  | RegisterMessage
  | JoinSessionMessage
  | SignalMessage
  | ChatMessage
  | FileOfferMessage
  | FileAcceptMessage
  | HeartbeatMessage
  | UnattendedRegisterMessage
  | UnattendedConnectMessage
  | UnattendedResponseMessage
  | SetAgentTagsMessage
  | ListGroupsMessage;

// Messages sent from relay to clients
export type ServerMessage =
  | SessionCreatedMessage
  | SessionJoinedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | SignalMessage
  | ChatMessage
  | FileOfferMessage
  | FileAcceptMessage
  | ErrorMessage
  | HeartbeatAckMessage
  | UnattendedRegisteredMessage
  | UnattendedAccessRequestMessage
  | UnattendedAccessResultMessage
  | UnattendedAgentListMessage
  | GroupListMessage;

// --- Client -> Server ---

export interface RegisterMessage {
  type: 'register';
  role: ClientRole;
  hostname?: string;
  os?: string;
  username?: string;
}

export interface JoinSessionMessage {
  type: 'join_session';
  sessionCode: string;
  role: ClientRole;
  displayName?: string;
}

export interface SignalMessage {
  type: 'signal';
  sessionCode: string;
  signal: RTCSignal;
}

export interface ChatMessage {
  type: 'chat';
  sessionCode: string;
  sender: ClientRole;
  text: string;
  timestamp: number;
}

export interface FileOfferMessage {
  type: 'file_offer';
  sessionCode: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
}

export interface FileAcceptMessage {
  type: 'file_accept';
  sessionCode: string;
  fileId: string;
  accepted: boolean;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
}

// --- Server -> Client ---

export interface SessionCreatedMessage {
  type: 'session_created';
  sessionCode: string;
}

export interface SessionJoinedMessage {
  type: 'session_joined';
  sessionCode: string;
  role: ClientRole;
}

export interface PeerJoinedMessage {
  type: 'peer_joined';
  sessionCode: string;
  role: ClientRole;
  displayName?: string;
}

export interface PeerLeftMessage {
  type: 'peer_left';
  sessionCode: string;
  role: ClientRole;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface HeartbeatAckMessage {
  type: 'heartbeat_ack';
}

// --- WebRTC Signaling ---

export type RTCSignal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice_candidate'; candidate: string; sdpMid?: string; sdpMLineIndex?: number };

// --- Data Channel Message Types (sent over WebRTC DataChannel) ---

export type DataChannelMessage =
  | DCInputMessage
  | DCChatMessage
  | DCFileChunkMessage
  | DCFileCompleteMessage;

export interface DCInputMessage {
  type: 'input';
  input: RemoteInput;
}

export interface DCChatMessage {
  type: 'dc_chat';
  text: string;
  timestamp: number;
}

export interface DCFileChunkMessage {
  type: 'file_chunk';
  fileId: string;
  chunkIndex: number;
  data: string; // base64 encoded
}

export interface DCFileCompleteMessage {
  type: 'file_complete';
  fileId: string;
  totalChunks: number;
  checksum: string;
}

// --- Remote Input Types ---

export type RemoteInput =
  | MouseMoveInput
  | MouseClickInput
  | MouseScrollInput
  | KeyboardInput;

export interface MouseMoveInput {
  action: 'mouse_move';
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
}

export interface MouseClickInput {
  action: 'mouse_click';
  x: number;
  y: number;
  button: 'left' | 'right' | 'middle';
  clickType: 'down' | 'up' | 'click' | 'dblclick';
  screenWidth: number;
  screenHeight: number;
}

export interface MouseScrollInput {
  action: 'mouse_scroll';
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  screenWidth: number;
  screenHeight: number;
}

export interface KeyboardInput {
  action: 'key';
  key: string;
  code: string;
  keyType: 'down' | 'up' | 'press';
  modifiers: {
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  };
}

// --- Unattended Access ---

/** Agent registers for persistent unattended access */
export interface UnattendedRegisterMessage {
  type: 'unattended_register';
  agentId: string;        // Persistent agent identifier
  accessKey: string;      // Pre-shared access key (hashed on server)
  hostname: string;
  os: string;
  username: string;
  timeoutMs?: number;     // Custom timeout for user to decline (default 30s)
  tags?: string[];        // Group tags for this agent (e.g. ["office-ny", "sales"])
}

/** Server confirms unattended registration */
export interface UnattendedRegisteredMessage {
  type: 'unattended_registered';
  agentId: string;
}

/** Portal requests connection to an unattended agent */
export interface UnattendedConnectMessage {
  type: 'unattended_connect';
  agentId: string;
  accessKey: string;
  displayName?: string;
}

/** Server notifies agent of incoming unattended access request */
export interface UnattendedAccessRequestMessage {
  type: 'unattended_access_request';
  requestId: string;
  displayName: string;
  timeoutMs: number;      // How long the user has to decline
}

/** Agent user responds to unattended access request (decline only - auto-accepts on timeout) */
export interface UnattendedResponseMessage {
  type: 'unattended_response';
  requestId: string;
  action: 'decline';      // Only decline is explicit; accept happens on timeout
}

/** Server notifies portal of access request result */
export interface UnattendedAccessResultMessage {
  type: 'unattended_access_result';
  agentId: string;
  granted: boolean;
  sessionCode?: string;   // If granted, the session code to use
  reason?: string;        // If denied, the reason
}

/** Server sends list of registered unattended agents to portal */
export interface UnattendedAgentListMessage {
  type: 'unattended_agent_list';
  agents: UnattendedAgentInfo[];
}

export interface UnattendedAgentInfo {
  agentId: string;
  hostname: string;
  os: string;
  username: string;
  online: boolean;
  lastSeen: number;
  tags: string[];
}

// --- Device Groups / Tags ---

/** Portal sets tags on an agent (portal-side group management) */
export interface SetAgentTagsMessage {
  type: 'set_agent_tags';
  agentId: string;
  tags: string[];
}

/** Portal requests the list of all known groups */
export interface ListGroupsMessage {
  type: 'list_groups';
}

/** Server sends back all known groups with agent counts */
export interface GroupListMessage {
  type: 'group_list';
  groups: GroupInfo[];
}

export interface GroupInfo {
  name: string;
  agentCount: number;
  onlineCount: number;
}
