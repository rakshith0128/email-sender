import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { unauthorized } from './error.js';

/**
 * Auth model.
 *
 * The frontend signs in with Google (Auth.js) and hands us the resulting
 * `id_token` exactly once, at /api/auth/google. We verify it against Google,
 * upsert the user, and issue our own session JWT.
 *
 * Google ID tokens expire after an hour; issuing our own longer-lived token
 * means a demo (or a reviewer poking at the API) never hits a surprise 401
 * partway through.
 */

export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

/** Verify a Google ID token and upsert the corresponding user. */
export async function verifyGoogleIdToken(idToken: string): Promise<AuthedUser> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw unauthorized('GOOGLE_CLIENT_ID is not configured on the backend');
  }

  const ticket = await googleClient
    .verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID })
    .catch(() => {
      throw unauthorized('Invalid Google ID token');
    });

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) throw unauthorized('Google token missing sub/email');

  const user = await prisma.user.upsert({
    where: { googleSub: payload.sub },
    update: {
      email: payload.email,
      name: payload.name ?? null,
      avatarUrl: payload.picture ?? null,
    },
    create: {
      googleSub: payload.sub,
      email: payload.email,
      name: payload.name ?? null,
      avatarUrl: payload.picture ?? null,
    },
  });

  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
}

export function issueSessionToken(user: AuthedUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

/**
 * When AUTH_DISABLED=true, fall back to a single local development user so the
 * API can be exercised from Postman/curl before Google credentials exist.
 */
async function devUser(): Promise<AuthedUser> {
  const user = await prisma.user.upsert({
    where: { googleSub: 'dev-local-user' },
    update: {},
    create: {
      googleSub: 'dev-local-user',
      email: 'dev@localhost',
      name: 'Local Dev User',
      avatarUrl: null,
    },
  });
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  void (async () => {
    try {
      if (env.AUTH_DISABLED) {
        req.user = await devUser();
        next();
        return;
      }

      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw unauthorized('Missing Bearer token');

      const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { sub?: string };
      if (!payload.sub) throw unauthorized('Malformed token');

      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) throw unauthorized('User no longer exists');

      req.user = { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
      next();
    } catch (err) {
      if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
        next(unauthorized('Invalid or expired session token'));
        return;
      }
      next(err);
    }
  })();
}
