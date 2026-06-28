import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import {
  upsertUser,
  setSubtaskDone,
  setSubtaskTitle,
  listDashboardTasks,
} from "@/lib/supabase/queries";
import { companionMessage } from "@/lib/companion";

export const dynamic = "force-dynamic";

/** Update a subtask — toggle completion ({ done }) or rename it ({ title }). Returns the
 * refreshed board so the client re-renders the strike-through / new name and an up-to-date
 * companion line in one state change. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const body = (await req.json().catch(() => ({}))) as { done?: boolean; title?: string };

    const userId = await upsertUser(session.email, session.name);
    if (typeof body.title === "string") {
      await setSubtaskTitle(id, userId, body.title);
    } else {
      await setSubtaskDone(id, userId, Boolean(body.done));
    }

    const tasks = await listDashboardTasks(userId);
    return NextResponse.json({ ok: true, tasks, companionMessage: companionMessage(tasks) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't update that step.";
    const status =
      message === "Subtask not found." ? 404 : message === "A step needs a name." ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
