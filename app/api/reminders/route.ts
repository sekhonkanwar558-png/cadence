import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { upsertUser, listReminders } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

/** The user's live reminders (active + snoozed); acknowledged/done drop off the list. */
export async function GET(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  try {
    const userId = await upsertUser(session.email, session.name);
    const reminders = await listReminders(userId);
    return NextResponse.json({ ok: true, reminders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't load your reminders.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
