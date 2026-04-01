import { Router, type Request, type Response } from 'express';
import { sessionStore } from '../session/store';
import { generateToken } from '../auth/jwt';
import { getRegisteredAgents } from '../session/unattended';
import type { ClientRole } from '../../../packages/shared/src';

const router = Router();

/**
 * GET /api/health
 * Basic health check endpoint.
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeSessions: sessionStore.listActive().length,
    totalSessions: sessionStore.size,
    timestamp: Date.now(),
  });
});

/**
 * GET /api/sessions
 * List all active (non-ended) sessions.
 */
router.get('/sessions', (_req: Request, res: Response) => {
  const sessions = sessionStore.listActive();
  res.json({ sessions });
});

/**
 * POST /api/auth/token
 * Generate a JWT for a client. Body: { role: 'agent' | 'portal' }
 * For MVP, tokens are freely issued.
 */
router.post('/auth/token', (req: Request, res: Response) => {
  const { role } = req.body as { role?: ClientRole };

  if (!role || (role !== 'agent' && role !== 'portal')) {
    res.status(400).json({ error: 'Invalid or missing "role". Must be "agent" or "portal".' });
    return;
  }

  const { token, clientId } = generateToken(role);
  res.json({ token, clientId });
});

/**
 * GET /api/agents
 * List all registered unattended agents and their online status.
 */
router.get('/agents', (_req: Request, res: Response) => {
  const agents = getRegisteredAgents();
  res.json({ agents });
});

export default router;
