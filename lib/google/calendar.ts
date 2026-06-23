import { google } from "googleapis";
import type { BusyBlock } from "@/lib/types";

export interface CalendarBlockInput {
  title: string;
  start_iso: string;
  end_iso: string;
  description?: string;
}

export interface CreatedEvent {
  eventLink: string;
  eventId: string;
}

/**
 * The user's Google OAuth credentials from the NextAuth JWT. The access token
 * expires after ~1 hour; passing the refresh token (+ client id/secret) lets the
 * googleapis client transparently mint a fresh access token before each call.
 */
export interface GoogleCredentials {
  accessToken: string;
  refreshToken?: string | null;
  /** Unix seconds (NextAuth `account.expires_at`). */
  expiresAt?: number | null;
}

function calendarClient(creds: GoogleCredentials) {
  // Supplying client id/secret + refresh_token enables automatic token refresh:
  // if the access token is expired, googleapis refreshes it before the request.
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken ?? undefined,
    expiry_date: creds.expiresAt ? creds.expiresAt * 1000 : undefined,
  });
  return google.calendar({ version: "v3", auth });
}

/**
 * Return the user's busy intervals in [startIso, endIso] via the free/busy API.
 * Read-only — used by the agent to place work blocks in genuinely free time.
 */
export async function getCalendarConflicts(
  creds: GoogleCredentials,
  startIso: string,
  endIso: string,
): Promise<BusyBlock[]> {
  const calendar = calendarClient(creds);
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: startIso,
      timeMax: endIso,
      items: [{ id: "primary" }],
    },
  });
  const busy = res.data.calendars?.primary?.busy ?? [];
  return busy
    .filter((b): b is { start: string; end: string } => Boolean(b.start && b.end))
    .map((b) => ({ start: b.start, end: b.end }));
}

/**
 * Create an event on the user's primary Google Calendar.
 */
export async function createCalendarEvent(
  creds: GoogleCredentials,
  input: CalendarBlockInput,
): Promise<CreatedEvent> {
  const calendar = calendarClient(creds);

  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: input.title,
      description: input.description,
      // start_iso / end_iso carry a UTC offset, so Google resolves the time
      // correctly without a separate timeZone field.
      start: { dateTime: input.start_iso },
      end: { dateTime: input.end_iso },
    },
  });

  return {
    eventLink: res.data.htmlLink ?? "",
    eventId: res.data.id ?? "",
  };
}
