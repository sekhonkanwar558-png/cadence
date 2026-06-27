import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { proposePlan } from "@/lib/agent/plan";
import { assessClarity } from "@/lib/gemini/clarify";
import { buildUserContext, buildScheduleContext } from "@/lib/agent/context";
import { upsertUser, insertProposedPlan } from "@/lib/supabase/queries";
import type { PlanResult, TaskInput, TaskClarification } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Not signed in with Google. Sign in and try again." },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Partial<TaskInput> & {
    clarification?: TaskClarification;
    skipClarify?: boolean;
  };
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

  // Layer C: assess vagueness ONCE — only when the client hasn't already answered or skipped.
  // This runs before any DB/planning work, so a vague task stays cheap until it's answered.
  const skipAssess = body.skipClarify === true || !!body.clarification;

  try {
    if (!skipAssess) {
      let question: string | null = null;
      try {
        question = await assessClarity(task.title, new Date().toISOString(), task.timezone);
      } catch (e) {
        // A failed assessment must never block planning — proceed as if the task were clear.
        console.warn("[plan] clarity assessment failed:", e);
      }
      if (question) {
        return NextResponse.json({ ok: true, needsClarification: true, question });
      }
    }

    // Fold a provided answer into context so decompose + the scheduling loop both see it.
    if (body.clarification?.answer?.trim()) {
      const { question, answer } = body.clarification;
      task.context = [task.context, `They clarified — Q: ${question} A: ${answer.trim()}`]
        .filter(Boolean)
        .join("\n");
    }

    const userId = await upsertUser(session.email, session.name);
    const [contextSummary, scheduleContext] = await Promise.all([
      buildUserContext(userId, task.timezone),
      buildScheduleContext(userId, new Date().toISOString(), task.timezone),
    ]);

    const proposal = await proposePlan({
      task,
      contextSummary,
      scheduleContext,
      credentials: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
      },
    });

    const inserted = await insertProposedPlan({
      userId,
      // Persist the resolved deadline (explicit value wins, else inferred from the text)
      // so the dashboard's "in X days" label shows for natural-language tasks.
      task: { ...task, deadline: task.deadline ?? proposal.deadline ?? undefined },
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
