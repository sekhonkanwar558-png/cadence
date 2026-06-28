import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { upsertUser, insertReminder } from "@/lib/supabase/queries";
import { parseReminder } from "@/lib/gemini/parseReminder";
import type { ReminderRecurrence, ReminderStakes } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAKES: ReadonlySet<string> = new Set(["low", "medium", "critical"]);
const RECURRENCE: ReadonlySet<string> = new Set(["daily", "weekly", "monthly"]);

/**
 * Create a reminder — a PURE deadline. Deliberately bypasses the decompose/plan
 * pipeline (no subtasks, no calendar blocks, no agent loop). SMART CAPTURE: when the
 * user didn't pin a deadline or stakes, one Gemini call infers them (and tidies the
 * title) from the raw line — the only AI touch in reminders.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    deadline?: string;
    stakes?: string;
    recurrence?: string;
    timezone?: string;
  };

  const raw = body.title?.trim();
  if (!raw) {
    return NextResponse.json(
      { ok: false, error: "What should I remind you about?" },
      { status: 400 },
    );
  }

  const timezone = body.timezone || "UTC";
  const recurrence = (RECURRENCE.has(body.recurrence ?? "")
    ? body.recurrence
    : null) as ReminderRecurrence | null;

  // What the user pinned explicitly wins; anything missing gets inferred by smart capture.
  let title = raw;
  let deadline = body.deadline?.trim() || null;
  let stakes: ReminderStakes | null = STAKES.has(body.stakes ?? "")
    ? (body.stakes as ReminderStakes)
    : null;

  try {
    if (!deadline || !stakes) {
      const parsed = await parseReminder(raw, new Date().toISOString(), timezone);
      title = parsed.title || raw;
      if (!deadline) deadline = parsed.deadline;
      if (!stakes) stakes = parsed.stakes;
    }
  } catch (e) {
    console.warn("[reminders] smart capture failed:", e);
  }

  if (!deadline || Number.isNaN(new Date(deadline).getTime())) {
    return NextResponse.json(
      { ok: false, error: "When's it due? Add a date so I can keep watch." },
      { status: 400 },
    );
  }

  try {
    const userId = await upsertUser(session.email, session.name);
    const reminder = await insertReminder({
      userId,
      title,
      deadline,
      stakes: stakes ?? "medium",
      recurrence,
    });
    return NextResponse.json({ ok: true, reminder });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't save that reminder.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
