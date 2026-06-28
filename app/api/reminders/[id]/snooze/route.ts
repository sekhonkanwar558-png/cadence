import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { upsertUser, setReminderStatus } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

/** Snooze a reminder until a given instant; it re-surfaces once that time passes. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { snoozedUntil?: string };
  const until = body.snoozedUntil?.trim();
  if (!until || Number.isNaN(new Date(until).getTime())) {
    return NextResponse.json(
      { ok: false, error: "Pick when to be reminded again." },
      { status: 400 },
    );
  }
  try {
    const userId = await upsertUser(session.email, session.name);
    await setReminderStatus(id, userId, { status: "snoozed", snoozed_until: until });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't snooze that reminder.";
    const status = message === "Reminder not found." ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
