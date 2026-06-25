import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { saveRefreshToken } from "@/lib/supabase/queries";

/**
 * Scopes: identity + full Calendar access + Gmail send + read-only Tasks.
 * - `calendar` covers create_calendar_block AND freebusy.query.
 * - `gmail.send` is the minimal scope to send mail (no inbox/draft read).
 * - `tasks.readonly` lets us read the user's Google Tasks (read-only).
 * gmail.send is added lazily: existing calendar-only sessions keep working and
 * only re-consent when the user actually sends an email.
 */
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/tasks.readonly",
].join(" ");

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          // access_type=offline + prompt=consent => Google returns a refresh_token
          access_type: "offline",
          prompt: "consent",
          scope: GOOGLE_SCOPES,
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      // `account` is only present on the first sign-in.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        // The space-delimited set of scopes the user actually granted.
        token.grantedScopes = account.scope;
        // Persist the refresh token for offline server-side Google calls (cron /
        // Edge Function). Best-effort: a DB hiccup must never block sign-in.
        if (account.refresh_token && token.email) {
          try {
            await saveRefreshToken(token.email, account.refresh_token);
          } catch (e) {
            console.error("Failed to persist Google refresh token", e);
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Surface to the client whether Gmail send was granted (drives the
      // "Connect Gmail to send" lazy re-consent). Never expose tokens here.
      session.hasGmail = Boolean(token.grantedScopes?.includes(GMAIL_SCOPE));
      return session;
    },
  },
};
