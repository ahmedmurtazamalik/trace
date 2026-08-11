import type { User, UserSession } from '@trace/database';
import type { Request } from 'express';

export const sessionCookieName = 'trace_session';

export interface AuthenticatedSession {
  user: User;
  session: UserSession;
  rawSessionToken: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthenticatedSession;
}

export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name === sessionCookieName) {
      const value = valueParts.join('=');
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
