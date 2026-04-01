export const DEFAULT_RELAY_PORT = 3001;
export const DEFAULT_PORTAL_PORT = 5173;
export const SESSION_CODE_LENGTH = 6;
export const SESSION_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;
export const WS_HEARTBEAT_TIMEOUT_MS = 10_000;
export const MAX_FILE_CHUNK_SIZE = 64 * 1024; // 64KB chunks for file transfer
export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB max file size
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Unattended access
export const UNATTENDED_ACCESS_TIMEOUT_MS = 30_000; // 30s for user to decline
export const UNATTENDED_ACCESS_KEY_LENGTH = 32;
export const UNATTENDED_AGENT_ID_LENGTH = 16;
