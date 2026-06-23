import "next-auth/jwt";

// Augment the NextAuth JWT so the Google tokens we stash in the jwt callback
// are typed everywhere (lib/auth.ts and getToken() in the agent route).
declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }
}
