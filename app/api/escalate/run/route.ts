import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { upsertUser, listDashboardTasks } from "@/lib/supabase/queries";
import { companionMessage } from "@/lib/companion";

export const dynamic = "force-dynamic";

/**
 * Server-side proxy to the `escalate` Edge Function. The service-role key (the
 * function's bearer secret) never touches the browser. After the function runs,
 * we re-query the signed-in user's tasks and return everything in ONE payload so
 * the dashboard banner + cards update from a single state change.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Server misconfigured." }, { status: 500 });
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/escalate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ source: "dashboard" }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Escalation function returned ${res.status}: ${text.slice(0, 200)}`);
    }

    const userId = await upsertUser(session.email, session.name);
    const tasks = await listDashboardTasks(userId);
    return NextResponse.json({ ok: true, tasks, companionMessage: companionMessage(tasks) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't check your deadlines.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
