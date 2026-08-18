import NextAuth, { type DefaultSession } from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Auth.js with the real Google provider — no mock.
 *
 * The important piece is the `jwt` callback: on first sign-in Google hands us
 * an `id_token`, which we immediately trade with our backend for a session JWT
 * of our own. Google ID tokens last an hour; ours lasts a week, so a long demo
 * (or a reviewer leaving a tab open) never hits a mid-session 401.
 *
 * The backend token lives only in the encrypted Auth.js cookie and is read on
 * the server, never persisted to localStorage.
 */

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

declare module 'next-auth' {
  interface Session {
    backendToken?: string;
    user: {
      id?: string;
    } & DefaultSession['user'];
  }
}

/**
 * Extra claims we stash on the Auth.js token. Applied as an intersection at the
 * two call sites rather than via `declare module 'next-auth/jwt'`, which does
 * not resolve under bundler module resolution in this Next version.
 */
interface BackendClaims {
  backendToken?: string;
  backendUserId?: string;
}

async function exchangeGoogleToken(
  idToken: string,
): Promise<{ token: string; userId: string } | null> {
  try {
    const response = await fetch(`${API_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      console.error('Backend token exchange failed:', response.status, await response.text());
      return null;
    }

    const data = (await response.json()) as { token: string; user: { id: string } };
    return { token: data.token, userId: data.user.id };
  } catch (error) {
    console.error('Backend token exchange threw — is the API running?', error);
    return null;
  }
}

/**
 * Whether Google OAuth credentials are present.
 *
 * Registering the provider without them makes Auth.js fail at request time
 * with an opaque "there is a problem with the server configuration" page, so
 * it is omitted instead and the sign-in screen explains what is missing.
 */
export const googleConfigured = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: googleConfigured
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
        }),
      ]
    : [],
  session: { strategy: 'jwt' },
  pages: { signIn: '/' },
  callbacks: {
    async jwt({ token, account }) {
      const claims = token as typeof token & BackendClaims;

      // `account` is only populated on the initial sign-in round-trip.
      if (account?.id_token) {
        const exchanged = await exchangeGoogleToken(account.id_token);

        // Refuse to mint a session we already know is unusable. Returning null
        // aborts sign-in, so the user lands back on the login screen with the
        // cause in the server log, rather than on a dashboard that cannot load.
        if (!exchanged) return null;

        claims.backendToken = exchanged.token;
        claims.backendUserId = exchanged.userId;
        return claims;
      }

      // A pre-existing session with no backend token can never acquire one:
      // `account` is gone, so the exchange cannot be retried. Invalidate it so
      // the next request restarts OAuth from scratch. Without this, a single
      // failed exchange (backend down, credentials not yet configured) leaves a
      // cookie that keeps the user permanently signed in and permanently broken.
      if (!claims.backendToken) return null;

      return claims;
    },

    session({ session, token }) {
      const claims = token as typeof token & BackendClaims;
      session.backendToken = claims.backendToken;
      if (claims.backendUserId) session.user.id = claims.backendUserId;
      return session;
    },
  },
});
