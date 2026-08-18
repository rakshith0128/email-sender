import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { asyncHandler } from '../middleware/error.js';
import { issueSessionToken, requireAuth, verifyGoogleIdToken } from '../middleware/auth.js';

export const authRouter = Router();

const exchangeSchema = z.object({
  idToken: z.string().min(10, 'idToken is required'),
});

/**
 * Called once by the frontend's Auth.js signIn callback. Trades a Google
 * `id_token` for this backend's own session JWT.
 */
authRouter.post(
  '/google',
  asyncHandler(async (req, res) => {
    const { idToken } = exchangeSchema.parse(req.body);
    const user = await verifyGoogleIdToken(idToken);
    logger.info({ email: user.email }, 'Google sign-in exchanged for a backend session');
    res.json({ token: issueSessionToken(user), user });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);
