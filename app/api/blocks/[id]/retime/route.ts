import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import {
  upsertUser,
  getBlockForRetime,
  markBlockCancelled,
  insertConfirmedBlock,
  listDashboardTasks,
} from "@/lib/supabase/queries";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/google/calendar";
import { wallClockToInstantIso } from "@/lib/time";
import { companionMessage } from "@/lib/companion";

export const dynamic = "force-dynamic";

/**
 * Retime a single scheduled block (slice 3 inline edit). There's no Calendar "update"
 * API, so we mirror the replan pattern at one-block granularity: create the new event
 * first (so a failure leaves the original intact), then delete the old event and cancel
 * the old block row. Returns the refreshed board so the open task detail re-renders in
 * one state change.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    start?: string;
    end?: string;
    timezone?: string;
  };

  const start = body.start?.trim();
  const end = body.end?.trim();
  if (!start || !end) {
    return NextResponse.json({ ok: false, error: "Pick a start and end time." }, { status: 400 });
  }
  const timezone = body.timezone || "UTC";

  try {
    // Resolve the naive wall-clock against the user's timezone (not UTC).
    const startIso = wallClockToInstantIso(start, timezone);
    const endIso = wallClockToInstantIso(end, timezone);
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      return NextResponse.json(
        { ok: false, error: "The end time needs to be after the start." },
        { status: 400 },
      );
    }

    const userId = await upsertUser(session.email, session.name);
    const block = await getBlockForRetime(id, userId);

    const credentials = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    };
    const title = block.title ?? "Scheduled work";

    // Create the replacement event first; only then retire the old one.
    const { eventId, eventLink } = await createCalendarEvent(credentials, {
      title,
      start_iso: startIso,
      end_iso: endIso,
    });
    await insertConfirmedBlock({
      taskId: block.taskId,
      title,
      startIso,
      endIso,
      gcalEventId: eventId,
      eventLink,
      subtaskId: block.subtaskId,
    });

    if (block.gcalEventId) {
      try {
        await deleteCalendarEvent(credentials, block.gcalEventId);
      } catch (e) {
        console.error(`Retime: couldn't delete old event ${block.gcalEventId}`, e);
      }
    }
    await markBlockCancelled(block.id);

    const tasks = await listDashboardTasks(userId);
    return NextResponse.json({ ok: true, tasks, companionMessage: companionMessage(tasks) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't move that block.";
    const status = message === "Block not found." ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
