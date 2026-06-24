import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { upsertUser, completeTask } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

/** Move a task to history — marks it completed and stamps completed_at. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const userId = await upsertUser(session.email, session.name);
    await completeTask(id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't complete that task.";
    const status = message === "Task not found." ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
