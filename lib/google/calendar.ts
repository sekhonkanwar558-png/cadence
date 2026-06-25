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

/** Where an imported item came from — drives the DB `source` column. */
export type ImportSource = "google_calendar" | "google_task";

/** A real calendar event OR Google Task, normalized for import/classification. */
export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  /** ISO start — `dateTime` for timed events, 00:00:00 UTC for all-day. */
  start: string;
  /** ISO end — used as the deadline; 23:59:59.999 UTC on the last day for all-day. */
  end: string;
  htmlLink: string;
  source: ImportSource;
  /** True for events from the birthdays calendar — forces a 'meeting' classification. */
  isBirthday?: boolean;
}

/** Google's event start/end: a timed event has `dateTime`, an all-day event has `date`. */
type GoogleEventTime = { dateTime?: string | null; date?: string | null };

/** Start as ISO. All-day events (date only) start at 00:00:00 UTC on their start date. */
function eventStartIso(t: GoogleEventTime | undefined): string {
  if (t?.dateTime) return t.dateTime;
  if (t?.date) return `${t.date}T00:00:00.000Z`;
  return "";
}

/**
 * End as ISO. All-day events (date only) end at 23:59:59.999 UTC on their LAST day.
 * People add deadlines as all-day events on their phones, so these must NOT be
 * skipped. Google's all-day `end.date` is EXCLUSIVE (the morning after the last
 * day), so end-of-day is one millisecond before that date's UTC midnight.
 */
function eventEndIso(t: GoogleEventTime | undefined): string {
  if (t?.dateTime) return t.dateTime;
  if (t?.date) return new Date(Date.parse(`${t.date}T00:00:00.000Z`) - 1).toISOString();
  return "";
}

/** Google's auto-managed contacts/birthdays calendar id. */
const BIRTHDAYS_CALENDAR_ID = "addressbook#contacts@group.v.calendar.google.com";

/** Fetch + normalize one calendar's events. Best-effort: a failing calendar yields []. */
async function fetchEventsForCalendar(
  calendar: ReturnType<typeof calendarClient>,
  calendarId: string,
  startIso: string,
  endIso: string,
): Promise<CalendarEvent[]> {
  const isBirthday = calendarId === BIRTHDAYS_CALENDAR_ID;
  try {
    const res = await calendar.events.list({
      calendarId,
      timeMin: startIso,
      timeMax: endIso,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });
    const rawItems = res.data.items ?? [];
    // TODO: temporary debug logging — remove once calendar sync is verified.
    console.log(`[listCalendarEvents DEBUG] calendar "${calendarId}": ${rawItems.length} raw item(s)`);
    return rawItems
      .filter((e) => e.status !== "cancelled" && Boolean(e.id))
      .map((e) => ({
        id: e.id ?? "",
        summary: e.summary ?? "(no title)",
        description: e.description ?? "",
        // Timed events use dateTime as-is; all-day events resolve their date to a
        // full UTC day so phone-entered all-day deadlines are captured, not dropped.
        start: eventStartIso(e.start),
        end: eventEndIso(e.end),
        htmlLink: e.htmlLink ?? "",
        source: "google_calendar" as const,
        isBirthday,
      }))
      .filter((e) => Boolean(e.start && e.end));
  } catch (e) {
    const err = e as { code?: number; message?: string; response?: { data?: unknown } };
    console.error(
      `[listCalendarEvents DEBUG] events.list("${calendarId}") threw:`,
      err.code,
      err.message,
      JSON.stringify(err.response?.data ?? {}),
    );
    return [];
  }
}

/**
 * Pull events from ALL of the user's relevant calendars within [startIso, endIso]:
 * every owned/writable + selected calendar (via calendarList), plus the birthdays
 * calendar. Each calendar is fetched in parallel and best-effort, then merged and
 * deduped by event id. Recurring events are expanded; cancelled ones are skipped.
 */
export async function listCalendarEvents(
  creds: GoogleCredentials,
  startIso: string,
  endIso: string,
): Promise<CalendarEvent[]> {
  const calendar = calendarClient(creds);

  // 1. Discover which calendars to pull. primary is always kept; secondary calendars
  //    only if the user owns/can-write them AND keeps them visible (selected).
  let calendarIds: string[] = [];
  try {
    const listRes = await calendar.calendarList.list();
    calendarIds = (listRes.data.items ?? [])
      .filter(
        (c) =>
          c.primary === true ||
          ((c.accessRole === "owner" || c.accessRole === "writer") && c.selected === true),
      )
      .map((c) => c.id)
      .filter((id): id is string => Boolean(id));
  } catch (e) {
    console.error("[listCalendarEvents DEBUG] calendarList.list threw, falling back to primary:", e);
    calendarIds = ["primary"];
  }

  // Always include the birthdays calendar.
  const idsToFetch = Array.from(new Set([...calendarIds, BIRTHDAYS_CALENDAR_ID]));
  console.log(`[listCalendarEvents DEBUG] fetching ${idsToFetch.length} calendar(s): ${idsToFetch.join(", ")}`);

  // 2. Fetch every calendar's events in parallel.
  const perCalendar = await Promise.all(
    idsToFetch.map((id) => fetchEventsForCalendar(calendar, id, startIso, endIso)),
  );

  // 3. Merge + dedup by event id (the same event can appear on more than one calendar).
  const byId = new Map<string, CalendarEvent>();
  for (const events of perCalendar) {
    for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);
  }
  const merged = [...byId.values()];
  console.log(`[listCalendarEvents DEBUG] merged ${merged.length} event(s) across calendars (post-dedup)`);
  return merged;
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
      // Popup nudges 60 + 15 min before — the core reminder behavior.
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 60 },
          { method: "popup", minutes: 15 },
        ],
      },
    },
  });

  return {
    eventLink: res.data.htmlLink ?? "",
    eventId: res.data.id ?? "",
  };
}

/**
 * Delete an event from the user's primary calendar. Used for best-effort cleanup
 * when a task is completed — callers should tolerate failures (e.g. already gone).
 */
export async function deleteCalendarEvent(
  creds: GoogleCredentials,
  eventId: string,
): Promise<void> {
  const calendar = calendarClient(creds);
  await calendar.events.delete({ calendarId: "primary", eventId });
}
