import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { upsertUser, acknowledgeReminder } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

/**
 * Acknowledge a reminder: the user has it handled. A one-off stops being chased; a
 * recurring one rolls forward to its next occurrence (returns `rolledTo`).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const userId = await upsertUser(session.email, session.name);
    const { rolledTo } = await acknowledgeReminder(id, userId);
    return NextResponse.json({ ok: true, rolledTo });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't update that reminder.";
    const status = message === "Reminder not found." ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
