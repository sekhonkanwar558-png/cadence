import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import {
  upsertUser,
  completeTask,
  getConfirmedBlocks,
  markBlockCancelled,
} from "@/lib/supabase/queries";
import { deleteCalendarEvent } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

/** Move a task to history — marks it completed, stamps completed_at, and cancels
 *  any upcoming Calendar events for it (best-effort; never blocks completion). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const userId = await upsertUser(session.email, session.name);
    await completeTask(id, userId);

    // Best-effort calendar cleanup: cancel only future events; leave past ones be.
    try {
      const blocks = await getConfirmedBlocks(id);
      const now = Date.now();
      const credentials = {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
      };
      for (const b of blocks) {
        if (new Date(b.start).getTime() <= now) continue;
        try {
          await deleteCalendarEvent(credentials, b.gcalEventId);
          await markBlockCancelled(b.id);
        } catch (e) {
          console.error(`Calendar cleanup: couldn't cancel block ${b.id}`, e);
        }
      }
    } catch (e) {
      console.error("Calendar cleanup failed for task", id, e);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't complete that task.";
    const status = message === "Task not found." ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
