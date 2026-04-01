import { SESSION_CODE_LENGTH, SESSION_CODE_CHARS } from '../../../packages/shared/src';
import crypto from 'crypto';

/**
 * Generate a cryptographically random session code.
 * Uses the shared character set (no ambiguous chars like I/O/0/1).
 */
export function generateSessionCode(): string {
  const bytes = crypto.randomBytes(SESSION_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < SESSION_CODE_LENGTH; i++) {
    code += SESSION_CODE_CHARS[bytes[i] % SESSION_CODE_CHARS.length];
  }
  return code;
}

/**
 * Validate the format of a session code (correct length, valid characters).
 */
export function isValidSessionCode(code: string): boolean {
  if (code.length !== SESSION_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!SESSION_CODE_CHARS.includes(ch)) return false;
  }
  return true;
}
