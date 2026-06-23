import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import {
  upsertUser,
  getProposedPlanForConfirm,
  markBlockConfirmed,
  markTaskActive,
} from "@/lib/supabase/queries";
import { createCalendarEvent } from "@/lib/google/calendar";
import type { ConfirmedBlock } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Not signed in with Google. Sign in and try again." },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { taskId?: string };
  if (!body.taskId) {
    return NextResponse.json({ ok: false, error: "Missing taskId." }, { status: 400 });
  }

  try {
    const userId = await upsertUser(session.email, session.name);
    const target = await getProposedPlanForConfirm(body.taskId, userId);
    if (!target) {
      return NextResponse.json({ ok: false, error: "Plan not found." }, { status: 404 });
    }

    // Cross the boundary only now (post-confirm): create the real Calendar events.
    const credentials = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    };

    const confirmed: ConfirmedBlock[] = [];
    for (const b of target.blocks) {
      const { eventId, eventLink } = await createCalendarEvent(credentials, {
        title: b.title,
        start_iso: b.start,
        end_iso: b.end,
        description: b.description ?? undefined,
      });
      await markBlockConfirmed(b.id, eventId, eventLink);
      confirmed.push({ id: b.id, title: b.title, start: b.start, end: b.end, eventLink });
    }

    await markTaskActive(body.taskId);
    return NextResponse.json({ ok: true, blocks: confirmed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't confirm the plan.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
