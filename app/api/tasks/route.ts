import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { upsertUser, listDashboardTasks } from "@/lib/supabase/queries";
import { companionMessage } from "@/lib/companion";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  try {
    const userId = await upsertUser(session.email, session.name);
    const tasks = await listDashboardTasks(userId);
    return NextResponse.json({ ok: true, tasks, companionMessage: companionMessage(tasks) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't load your tasks.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
