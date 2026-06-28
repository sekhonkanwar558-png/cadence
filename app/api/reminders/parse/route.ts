import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { parseReminder } from "@/lib/gemini/parseReminder";

export const dynamic = "force-dynamic";

/**
 * SMART CAPTURE, stage 1: read a raw reminder line into { title, deadline, stakes }
 * WITHOUT saving — so the composer can show the user what Cadence understood and let
 * them confirm before it's stored. Mirrors the task planner's plan→confirm split.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    timezone?: string;
  };

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json(
      { ok: false, error: "What should I remind you about?" },
      { status: 400 },
    );
  }

  const timezone = body.timezone || "UTC";

  try {
    const parsed = await parseReminder(text, new Date().toISOString(), timezone);
    return NextResponse.json({ ok: true, ...parsed });
  } catch (e) {
    // Network/model failure — fall back to the raw text so the user can still confirm.
    console.warn("[reminders] parse failed:", e);
    return NextResponse.json({ ok: true, title: text, deadline: null, stakes: "medium" });
  }
}
