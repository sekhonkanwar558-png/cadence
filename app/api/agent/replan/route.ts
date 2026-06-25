import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { replan } from "@/lib/gemini/replan";
import type { FinalizeItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Revise the in-flight proposal from a natural-language instruction. The plan isn't
 * persisted until /confirm, so this is a stateless transform — it just reshapes the
 * items the user is editing and hands them back.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Not signed in with Google. Sign in and try again." },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    taskTitle?: string;
    deadline?: string | null;
    instruction?: string;
    items?: FinalizeItem[];
    timezone?: string;
  };

  if (!body.instruction?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Tell me what to change." },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "There's no plan to revise yet." },
      { status: 400 },
    );
  }

  try {
    const result = await replan({
      taskTitle: body.taskTitle?.trim() || "this task",
      deadline: body.deadline ?? null,
      instruction: body.instruction.trim(),
      items: body.items,
      now: new Date().toISOString(),
      timezone: body.timezone || "UTC",
    });

    return NextResponse.json({ ok: true, items: result.items, note: result.note });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't revise the plan.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
