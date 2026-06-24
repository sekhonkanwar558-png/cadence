import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { upsertUser, setSubtaskDone, listDashboardTasks } from "@/lib/supabase/queries";
import { companionMessage } from "@/lib/companion";

export const dynamic = "force-dynamic";

/** Toggle a subtask's completion. Returns the refreshed board so the client can
 * re-render the strike-through and an up-to-date companion line in one state change. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const body = (await req.json().catch(() => ({}))) as { done?: boolean };
    const done = Boolean(body.done);

    const userId = await upsertUser(session.email, session.name);
    await setSubtaskDone(id, userId, done);

    const tasks = await listDashboardTasks(userId);
    return NextResponse.json({ ok: true, tasks, companionMessage: companionMessage(tasks) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't update that step.";
    const status = message === "Subtask not found." ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
