import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'http';
import { verifyToken, type TokenPayload } from './jwt';

/**
 * Extend Express Request to carry the decoded token.
 */
export interface AuthenticatedRequest extends Request {
  auth?: TokenPayload;
}

/**
 * Express middleware: validates the Bearer token in the Authorization header.
 * For MVP, routes that don't need auth can simply skip this middleware.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.auth = payload;
  next();
}

/**
 * Extract and validate a token from a WebSocket upgrade request.
 * The token can be in:
 *   - query parameter: ?token=...
 *   - Authorization header: Bearer ...
 */
export function authenticateWsUpgrade(req: IncomingMessage): TokenPayload | null {
  // Try query parameter first
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    return verifyToken(queryToken);
  }

  // Fall back to Authorization header
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return verifyToken(header.slice(7));
  }

  return null;
}
