import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/**
 * Scopes: identity + full Calendar access. We need read+write on events
 * (create_calendar_block) AND free/busy lookups (get_calendar_conflicts).
 * `calendar.events` alone does NOT permit freebusy.query — the full `calendar`
 * scope covers both. Gmail is added in a later day.
 */
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
].join(" ");

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
      }
      return token;
    },
  },
};
