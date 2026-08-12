import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(`session:${token}`).digest('hex');
}

export function deriveCsrfToken(sessionToken: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${sessionToken}`).digest('base64url');
}

export function hashCsrfToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
