import "next-auth";
import "next-auth/jwt";

// Augment the NextAuth JWT so the Google tokens we stash in the jwt callback
// are typed everywhere (lib/auth.ts and getToken() in the API routes).
declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    /** Space-delimited scopes the user granted at consent. */
    grantedScopes?: string;
  }
}

declare module "next-auth" {
  interface Session {
    /** Whether the gmail.send scope was granted (drives lazy re-consent). */
    hasGmail?: boolean;
  }
}
