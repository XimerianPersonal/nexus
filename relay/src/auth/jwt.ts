import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';
import type { ClientRole } from '../../../packages/shared/src';

export interface TokenPayload {
  sub: string; // unique client ID
  role: ClientRole;
  iat: number;
}

/**
 * Generate a JWT for a connecting client.
 * For MVP, tokens are issued freely -- the relay trusts that
 * clients self-declare their role. In production this would be
 * gated behind proper authentication.
 */
export function generateToken(role: ClientRole): { token: string; clientId: string } {
  const clientId = uuidv4();
  const payload: TokenPayload = {
    sub: clientId,
    role,
    iat: Math.floor(Date.now() / 1000),
  };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '24h' });
  return { token, clientId };
}

/**
 * Validate and decode a JWT. Returns the payload on success, null on failure.
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as TokenPayload;
    return decoded;
  } catch {
    return null;
  }
}
