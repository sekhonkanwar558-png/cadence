import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { buildUserContext } from "@/lib/agent/context";
import { decompose } from "@/lib/gemini/decompose";
import { classifyCalendarEvents } from "@/lib/gemini/classify";
import { listCalendarEvents, type CalendarEvent } from "@/lib/google/calendar";
import { listGoogleTasks } from "@/lib/google/tasks";
import {
  upsertUser,
  getImportDedupIds,
  insertImportedTask,
  setCalendarSyncedAt,
  getCalendarSyncedAt,
  listDashboardTasks,
} from "@/lib/supabase/queries";
import { companionMessage } from "@/lib/companion";

export const dynamic = "force-dynamic";

const SYNC_WINDOW_DAYS = 14;

/** Return when the user last synced their calendar (for the "Last synced…" label). */
export async function GET(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  try {
    const userId = await upsertUser(session.email, session.name);
    const lastSynced = await getCalendarSyncedAt(userId);
    return NextResponse.json({ ok: true, lastSynced });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read sync status.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Pull the user's Google Calendar (next 14 days) into Cadence. Each new event is
 * classified by Gemini: 'deadline' events are decomposed into a task + subtasks,
 * 'meeting' events are surfaced as a single context card, and Cadence's own work-
 * blocks are skipped. Idempotent — already-imported events are deduped out.
 * Returns the refreshed board in ONE payload so the dashboard updates at once.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Not signed in with Google. Sign in and try again." },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { timezone?: string };
  const timezone = body.timezone || "UTC";

  const credentials = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };

  try {
    const userId = await upsertUser(session.email, session.name);

    const now = new Date();
    const windowEnd = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 3600000);

    // TODO: temporary debug logging — remove once calendar sync is verified.
    console.log(
      `[calendar/sync DEBUG] accessToken(first20)=${
        credentials.accessToken ? credentials.accessToken.slice(0, 20) : "MISSING"
      } len=${credentials.accessToken?.length ?? 0} | refreshToken=${
        credentials.refreshToken ? "present" : "MISSING"
      } | expiresAt=${credentials.expiresAt} | nowEpoch=${Math.floor(Date.now() / 1000)}`,
    );
    console.log(
      `[calendar/sync DEBUG] timeMin=${now.toISOString()} | timeMax=${windowEnd.toISOString()}`,
    );

    // Pull calendar events (all calendars + birthdays) and Google Tasks in parallel.
    // Both are best-effort internally, so a failure in one source doesn't lose the other.
    let calendarEvents: CalendarEvent[] = [];
    let googleTasks: CalendarEvent[] = [];
    try {
      [calendarEvents, googleTasks] = await Promise.all([
        listCalendarEvents(credentials, now.toISOString(), windowEnd.toISOString()),
        listGoogleTasks(credentials),
      ]);
    } catch (e) {
      console.error("[calendar/sync DEBUG] fetch threw:", e);
      throw e;
    }

    // Merge calendar events + tasks, dedup by id (tasks use the task_ id namespace).
    const mergedById = new Map<string, CalendarEvent>();
    for (const item of [...calendarEvents, ...googleTasks]) {
      if (!mergedById.has(item.id)) mergedById.set(item.id, item);
    }
    const events = [...mergedById.values()];

    console.log(
      `[calendar/sync DEBUG] merged ${events.length} item(s): ` +
        `${calendarEvents.length} calendar event(s) + ${googleTasks.length} task(s):`,
    );
    for (const e of events) {
      console.log(
        `[calendar/sync DEBUG]   • "${e.summary}" | ${e.start} → ${e.end} | id=${e.id} | source=${e.source}`,
      );
    }

    const { importedEventIds, cadenceEventIds } = await getImportDedupIds(userId);
    const newEvents = events.filter(
      (e) => !importedEventIds.has(e.id) && !cadenceEventIds.has(e.id),
    );

    console.log(
      `[calendar/sync DEBUG] dedup: ${events.length - newEvents.length} skipped ` +
        `(${importedEventIds.size} already imported, ${cadenceEventIds.size} Cadence-created), ` +
        `${newEvents.length} new to classify.`,
    );

    let imported = 0;
    if (newEvents.length > 0) {
      const classes = await classifyCalendarEvents(newEvents);
      const contextSummary = await buildUserContext(userId, timezone);

      // TODO: temporary debug logging — remove once calendar sync is verified.
      console.log("[calendar/sync DEBUG] Gemini classifications:");
      for (const e of newEvents) {
        console.log(`[calendar/sync DEBUG]   • "${e.summary}" → ${classes.get(e.id) ?? "meeting"}`);
      }

      for (const event of newEvents) {
        const cls = classes.get(event.id) ?? "meeting";
        if (cls === "cadence") continue; // defensive — our own blocks already deduped out

        try {
          if (cls === "deadline") {
            const { subtasks } = await decompose({
              title: event.summary,
              deadline: event.end,
              type: "deadline",
              context: event.description || undefined,
              now: now.toISOString(),
              timezone,
              contextSummary,
            });
            const id = await insertImportedTask({
              userId,
              title: event.summary,
              deadline: event.end,
              type: "deadline",
              eventType: "deadline",
              googleEventId: event.id,
              source: event.source,
              subtasks,
            });
            if (id) imported++;
          } else {
            // meeting — surface as context only, no decomposition
            const id = await insertImportedTask({
              userId,
              title: event.summary,
              deadline: event.start,
              type: "meeting",
              eventType: "meeting",
              googleEventId: event.id,
              source: event.source,
              subtasks: [],
            });
            if (id) imported++;
          }
        } catch (e) {
          // One bad event never fails the whole sync.
          console.error(`Calendar sync: couldn't import event ${event.id}`, e);
        }
      }
    }

    const lastSynced = await setCalendarSyncedAt(userId);
    const tasks = await listDashboardTasks(userId);

    return NextResponse.json({
      ok: true,
      imported,
      skipped: events.length - newEvents.length,
      lastSynced,
      tasks,
      companionMessage: companionMessage(tasks),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't sync your calendar.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
