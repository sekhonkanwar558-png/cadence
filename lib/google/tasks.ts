import { google } from "googleapis";
import type { CalendarEvent, GoogleCredentials } from "@/lib/google/calendar";

function tasksClient(creds: GoogleCredentials) {
  // Same refresh-enabled OAuth2 setup as the calendar client.
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken ?? undefined,
    expiry_date: creds.expiresAt ? creds.expiresAt * 1000 : undefined,
  });
  return google.tasks({ version: "v1", auth });
}

/**
 * Google Tasks `due` is date-only (always midnight UTC). Resolve it to 23:59:59.999
 * UTC that day, so a task deadline matches the all-day calendar-event convention.
 */
function dueToEndOfDayIso(due: string): string {
  const d = new Date(due);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  ).toISOString();
}

const HORIZON_DAYS = 14;

/**
 * Read the user's Google Tasks (default list), keeping only incomplete tasks with a
 * due date in the next 14 days, mapped to the shared CalendarEvent shape. Best-effort:
 * a missing `tasks.readonly` scope (older sessions) or any failure returns [] so the
 * rest of calendar sync still runs. Requires re-consent to grant the new scope.
 */
export async function listGoogleTasks(creds: GoogleCredentials): Promise<CalendarEvent[]> {
  try {
    const tasks = tasksClient(creds);
    const res = await tasks.tasks.list({
      tasklist: "@default",
      showCompleted: false,
      showHidden: false,
      maxResults: 100,
    });

    const now = Date.now();
    const horizon = now + HORIZON_DAYS * 24 * 3600000;

    const items = res.data.items ?? [];
    // TODO: temporary debug logging — remove once calendar sync is verified.
    console.log(`[listGoogleTasks DEBUG] raw tasks from Google: ${items.length}`);

    return items
      .filter((t) => Boolean(t.id && t.title && t.due))
      .filter((t) => {
        const dueMs = new Date(t.due as string).getTime();
        return dueMs >= now && dueMs <= horizon;
      })
      .map((t) => ({
        id: `task_${t.id}`,
        summary: t.title ?? "(untitled task)",
        description: t.notes ?? "",
        start: t.due as string,
        end: dueToEndOfDayIso(t.due as string),
        htmlLink: "",
        source: "google_task" as const,
      }));
  } catch (e) {
    const err = e as { code?: number; message?: string; response?: { data?: unknown } };
    console.error(
      "[listGoogleTasks DEBUG] tasks.list threw (likely missing tasks.readonly scope — re-consent needed):",
      err.code,
      err.message,
      JSON.stringify(err.response?.data ?? {}),
    );
    return [];
  }
}
