import { google } from "googleapis";
import type { GoogleCredentials } from "@/lib/google/calendar";

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

/** Error thrown when Gmail rejects for auth/scope reasons (→ trigger re-consent). */
export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

/**
 * Mint a non-expired access token via the OAuth2 refresh flow (same pattern as
 * the calendar client) so a stale token never trips up the raw Gmail call.
 */
async function freshAccessToken(creds: GoogleCredentials): Promise<string> {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken ?? undefined,
    expiry_date: creds.expiresAt ? creds.expiresAt * 1000 : undefined,
  });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new GmailAuthError("Could not obtain a Google access token.");
  return token;
}

function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Send a plain-text email via the Gmail REST API (messages.send) using the
 * gmail.send scope. The Gmail call is a raw fetch (no SDK); the draft itself
 * lives in Supabase — sending lands the message in the user's Gmail "Sent".
 */
export async function sendEmail(
  creds: GoogleCredentials,
  input: SendEmailInput,
): Promise<{ messageId: string }> {
  const token = await freshAccessToken(creds);

  const mime = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "MIME-Version: 1.0",
    "",
    input.body,
  ].join("\r\n");

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64url(mime) }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    // 401/403 → missing/expired Gmail authorization → caller prompts re-consent.
    if (res.status === 401 || res.status === 403) {
      throw new GmailAuthError(`Gmail authorization needed (${res.status}).`);
    }
    throw new Error(`Gmail send failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id?: string };
  return { messageId: data.id ?? "" };
}
