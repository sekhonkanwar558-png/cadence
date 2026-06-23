import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

export interface SessionContext {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  email: string;
  name: string | null;
}

/**
 * Read the signed-in user's Google credentials + identity from the NextAuth
 * JWT (server-side only). Includes the refresh token + expiry so the Google
 * client can refresh the (short-lived) access token. Returns null if not signed in.
 */
export async function getSessionContext(req: NextRequest): Promise<SessionContext | null> {
  const token = await getToken({ req });
  if (!token?.accessToken || !token.email) return null;
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? null,
    expiresAt: token.expiresAt ?? null,
    email: token.email,
    name: typeof token.name === "string" ? token.name : null,
  };
}
