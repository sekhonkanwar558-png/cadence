import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { upsertUser, seedDemo, listDashboardTasks } from "@/lib/supabase/queries";
import { companionMessage } from "@/lib/companion";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  try {
    const userId = await upsertUser(session.email, session.name);
    await seedDemo(userId);
    const tasks = await listDashboardTasks(userId);
    return NextResponse.json({ ok: true, tasks, companionMessage: companionMessage(tasks) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't load the demo.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
