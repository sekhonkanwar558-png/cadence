import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import {
  upsertUser,
  getTaskForReschedule,
  insertConfirmedBlock,
} from "@/lib/supabase/queries";
import { getCalendarConflicts, createCalendarEvent } from "@/lib/google/calendar";
import type { BusyBlock } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Earliest free slot of `durationMin` starting from `from`, avoiding busy blocks. */
function findNextFreeSlot(
  busy: BusyBlock[],
  from: Date,
  durationMin: number,
): { start: string; end: string } {
  const durMs = durationMin * 60000;
  const quarter = 15 * 60000;
  // Round up to the next quarter hour, with a small buffer.
  let cursor = Math.ceil((from.getTime() + 10 * 60000) / quarter) * quarter;

  const intervals = busy
    .map((b) => ({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() }))
    .sort((a, b) => a.s - b.s);

  for (const iv of intervals) {
    if (cursor + durMs <= iv.s) break; // fits before this busy block
    if (cursor < iv.e) cursor = iv.e; // jump past it
  }

  return {
    start: new Date(cursor).toISOString(),
    end: new Date(cursor + durMs).toISOString(),
  };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const userId = await upsertUser(session.email, session.name);
    const target = await getTaskForReschedule(id, userId);
    if (!target) {
      return NextResponse.json({ ok: false, error: "Task not found." }, { status: 404 });
    }
    if (target.incompleteSubtasks.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nothing left to reschedule — this one's done." },
        { status: 400 },
      );
    }

    const credentials = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    };

    const now = new Date();
    const deadline = target.task.deadline
      ? new Date(target.task.deadline)
      : new Date(now.getTime() + 24 * 3600000);

    const remaining = target.incompleteSubtasks.reduce(
      (sum, s) => sum + (s.effort_minutes ?? 30),
      0,
    );
    const durationMin = Math.min(90, Math.max(30, remaining));

    const busy = await getCalendarConflicts(credentials, now.toISOString(), deadline.toISOString());
    const slot = findNextFreeSlot(busy, now, durationMin);

    const description =
      "Remaining work:\n" + target.incompleteSubtasks.map((s) => `• ${s.title}`).join("\n");

    const { eventId, eventLink } = await createCalendarEvent(credentials, {
      title: `Focus: ${target.task.title}`,
      start_iso: slot.start,
      end_iso: slot.end,
      description,
    });

    const blockId = await insertConfirmedBlock({
      taskId: id,
      title: `Focus: ${target.task.title}`,
      startIso: slot.start,
      endIso: slot.end,
      description,
      gcalEventId: eventId,
      eventLink,
    });

    return NextResponse.json({
      ok: true,
      block: { id: blockId, title: `Focus: ${target.task.title}`, start: slot.start, end: slot.end, eventLink },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't reschedule.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
