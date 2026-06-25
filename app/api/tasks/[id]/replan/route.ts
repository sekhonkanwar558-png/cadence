import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import {
  upsertUser,
  getTaskForReschedule,
  getFutureBlocksForReschedule,
  markBlockCancelled,
  insertConfirmedBlock,
} from "@/lib/supabase/queries";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/google/calendar";
import { replan } from "@/lib/gemini/replan";
import { wallClockToInstantIso } from "@/lib/time";
import type { ConfirmedBlock, FinalizeItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Layer 3 — re-plan an ALREADY-ACTIVE task from a plain-language instruction.
 * Unlike the proposal-stage replan (which only reshapes staged items), this one
 * crosses the boundary: it supersedes the task's future calendar events with the
 * revised plan. The user's explicit instruction is the confirmation, exactly as the
 * "Reschedule remaining work" button is — this is the conversational version of it.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    instruction?: string;
    timezone?: string;
  };
  if (!body.instruction?.trim()) {
    return NextResponse.json({ ok: false, error: "Tell me what to change." }, { status: 400 });
  }
  const timezone = body.timezone || "UTC";

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

    // The remaining work, handed to the model unscheduled so it can re-place every
    // piece according to the instruction (past-slot guarding lives inside replan).
    const currentItems: FinalizeItem[] = target.incompleteSubtasks.map((s) => ({
      title: s.title,
      effortMinutes: s.effort_minutes ?? 30,
      start: null,
      end: null,
    }));

    const { items: revised, note } = await replan({
      taskTitle: target.task.title,
      deadline: target.task.deadline,
      instruction: body.instruction.trim(),
      items: currentItems,
      now: new Date().toISOString(),
      timezone,
    });

    // Clear the future slots we're superseding — keep any whose subtask is already
    // done (that work is finished). Best-effort per block; never blocks the replan.
    const existing = await getFutureBlocksForReschedule(id);
    for (const b of existing) {
      if (b.subtaskStatus === "done") continue;
      try {
        await deleteCalendarEvent(credentials, b.gcalEventId);
        await markBlockCancelled(b.id);
      } catch (e) {
        console.error(`Replan cleanup: couldn't cancel block ${b.id}`, e);
      }
    }

    // Create the revised plan as real Calendar events.
    const confirmed: ConfirmedBlock[] = [];
    for (const it of revised) {
      if (!it.start || !it.end) continue; // an unscheduled step stays a subtask only

      const startIso = wallClockToInstantIso(it.start, timezone);
      const endIso = wallClockToInstantIso(it.end, timezone);

      const { eventId, eventLink } = await createCalendarEvent(credentials, {
        title: it.title,
        start_iso: startIso,
        end_iso: endIso,
      });
      const blockId = await insertConfirmedBlock({
        taskId: id,
        title: it.title,
        startIso,
        endIso,
        gcalEventId: eventId,
        eventLink,
      });
      confirmed.push({ id: blockId, title: it.title, start: startIso, end: endIso, eventLink });
    }

    return NextResponse.json({ ok: true, blocks: confirmed, note });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't revise the plan.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
