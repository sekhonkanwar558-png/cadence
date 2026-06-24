import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { proposePlan } from "@/lib/agent/plan";
import { buildUserContext } from "@/lib/agent/context";
import { upsertUser, insertProposedPlan } from "@/lib/supabase/queries";
import type { PlanResult, TaskInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Not signed in with Google. Sign in and try again." },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Partial<TaskInput>;
  if (!body.title?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Tell me what's on your plate." },
      { status: 400 },
    );
  }

  const task: TaskInput = {
    title: body.title.trim(),
    deadline: body.deadline,
    type: body.type,
    importance: body.importance,
    context: body.context,
    timezone: body.timezone || "UTC",
  };

  try {
    const userId = await upsertUser(session.email, session.name);
    const contextSummary = await buildUserContext(userId, task.timezone);

    const proposal = await proposePlan({
      task,
      contextSummary,
      credentials: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
      },
    });

    const inserted = await insertProposedPlan({
      userId,
      task,
      subtasks: proposal.subtasks,
      blocks: proposal.blocks,
      email: proposal.email,
    });

    const result: PlanResult = {
      taskId: inserted.taskId,
      companionSummary: proposal.companionSummary,
      recommendation: proposal.recommendation || undefined,
      task: {
        id: inserted.taskRow.id,
        title: inserted.taskRow.title,
        type: inserted.taskRow.type,
        deadline: inserted.taskRow.deadline,
        importance: inserted.taskRow.importance,
        status: inserted.taskRow.status,
      },
      subtasks: proposal.subtasks,
      blocks: inserted.blocks,
      emailDraft: inserted.email,
    };

    return NextResponse.json({ ok: true, plan: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't build a plan.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
