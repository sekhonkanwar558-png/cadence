import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import {
  upsertUser,
  getProposedPlanForConfirm,
  markBlockConfirmed,
  markTaskActive,
  deleteProposedBlocks,
  replaceProposedSubtasks,
  insertConfirmedBlock,
} from "@/lib/supabase/queries";
import { createCalendarEvent } from "@/lib/google/calendar";
import { wallClockToInstantIso } from "@/lib/time";
import type { ConfirmedBlock, FinalizeItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Not signed in with Google. Sign in and try again." },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    taskId?: string;
    timezone?: string;
    items?: FinalizeItem[];
  };
  if (!body.taskId) {
    return NextResponse.json({ ok: false, error: "Missing taskId." }, { status: 400 });
  }

  try {
    const userId = await upsertUser(session.email, session.name);
    const target = await getProposedPlanForConfirm(body.taskId, userId);
    if (!target) {
      return NextResponse.json({ ok: false, error: "Plan not found." }, { status: 404 });
    }

    // Cross the boundary only now (post-confirm): create the real Calendar events.
    const credentials = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    };

    // Edited path: reconcile the proposal to the user's edits, then create events from them.
    if (body.items) {
      const timezone = body.timezone || "UTC";

      await deleteProposedBlocks(body.taskId);
      const subtaskRows = await replaceProposedSubtasks(
        body.taskId,
        body.items.map((it, i) => ({
          title: it.title,
          effort_minutes: it.effortMinutes,
          order: i + 1,
        })),
      );
      const subtaskIdByOrder = new Map(subtaskRows.map((r) => [r.order, r.id]));

      const confirmed: ConfirmedBlock[] = [];
      for (let i = 0; i < body.items.length; i++) {
        const it = body.items[i];
        if (!it.start || !it.end) continue; // an unscheduled step — kept as a subtask only

        // Resolve the naive wall-clock against the user's timezone (not UTC).
        const startIso = wallClockToInstantIso(it.start, timezone);
        const endIso = wallClockToInstantIso(it.end, timezone);

        const { eventId, eventLink } = await createCalendarEvent(credentials, {
          title: it.title,
          start_iso: startIso,
          end_iso: endIso,
        });
        const blockId = await insertConfirmedBlock({
          taskId: body.taskId,
          title: it.title,
          startIso,
          endIso,
          gcalEventId: eventId,
          eventLink,
          subtaskId: subtaskIdByOrder.get(i + 1) ?? null,
        });
        confirmed.push({ id: blockId, title: it.title, start: startIso, end: endIso, eventLink });
      }

      await markTaskActive(body.taskId);
      return NextResponse.json({ ok: true, blocks: confirmed });
    }

    // Legacy path (no edits sent): confirm the DB-proposed blocks as-is.
    const confirmed: ConfirmedBlock[] = [];
    for (const b of target.blocks) {
      const { eventId, eventLink } = await createCalendarEvent(credentials, {
        title: b.title,
        start_iso: b.start,
        end_iso: b.end,
        description: b.description ?? undefined,
      });
      await markBlockConfirmed(b.id, eventId, eventLink);
      confirmed.push({ id: b.id, title: b.title, start: b.start, end: b.end, eventLink });
    }

    await markTaskActive(body.taskId);
    return NextResponse.json({ ok: true, blocks: confirmed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't confirm the plan.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
