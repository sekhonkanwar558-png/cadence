import {
  FunctionCallingConfigMode,
  type Content,
  type FunctionCall,
  type Part,
} from "@google/genai";
import { generateContentWithRetry } from "@/lib/gemini/client";
import { planningTools } from "@/lib/gemini/tools";
import { decompose } from "@/lib/gemini/decompose";
import { extractDeadline } from "@/lib/gemini/extract-deadline";
import { getCalendarConflicts, type GoogleCredentials } from "@/lib/google/calendar";
import type { ProposedBlock, ProposedEmail, Subtask, TaskInput } from "@/lib/types";

const MAX_ROUNDS = 8;

export interface ProposeArgs {
  task: TaskInput;
  credentials: GoogleCredentials;
  /** Lightweight history summary fed to the recommendation prompt (§4). */
  contextSummary?: string;
}

export interface ProposeOutput {
  subtasks: Subtask[];
  blocks: ProposedBlock[];
  email: ProposedEmail | null;
  companionSummary: string;
  recommendation: string;
  /** Resolved deadline (ISO) — explicit user value, else inferred from the task text, else null. */
  deadline: string | null;
}

function systemPrompt(task: TaskInput, now: string): string {
  return [
    "You are Cadence, a calm productivity companion. You don't just advise — you act.",
    `Current time: ${now}. User's timezone: ${task.timezone}.`,
    "",
    "Plan how to get this task done, working through your tools IN THIS ORDER:",
    "1. Call decompose_task to break it into ordered subtasks with effort estimates.",
    "2. Call get_calendar_conflicts over the window from now until the deadline to see busy time.",
    "3. Call create_calendar_block once per work session, placing each in genuinely free time",
    "   (avoid the busy intervals), 25-90 min each with short gaps, within ~09:00-21:00 the",
    "   user's local time, never in the past, finishing before the deadline. Map each block to a",
    "   subtask and give a one-line reason.",
    "4. ONLY if the task clearly implies a message to someone (e.g. asking for an extension),",
    "   call draft_email once.",
    "When you are done calling tools, reply with ONE warm, plain sentence summarizing the plan",
    "(the user will see it). Do not list the blocks again in prose.",
    "",
    `Task: ${task.title}`,
    task.type ? `Type: ${task.type}` : "",
    task.deadline
      ? `Deadline: ${task.deadline}`
      : "If the task text implies a deadline (e.g. 'by Friday 5pm'), infer it and schedule before it; otherwise schedule sensibly within the next few days.",
    task.context ? `Context: ${task.context}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The propose phase: a genuine multi-tool function-calling loop. Read/in-app
 * tools (decompose_task, get_calendar_conflicts) execute for real; outside-world
 * tools (create_calendar_block, draft_email) are STAGED — collected here and only
 * carried out after the user confirms (§7/§8).
 */
export async function proposePlan({
  task,
  credentials,
  contextSummary,
}: ProposeArgs): Promise<ProposeOutput> {
  const now = new Date().toISOString();

  const subtasks: Subtask[] = [];
  const blocks: ProposedBlock[] = [];
  let email: ProposedEmail | null = null;
  let companionSummary = "";
  let recommendation = "";
  // (1) An explicit user-supplied deadline always wins; otherwise we capture what the
  // model infers during decomposition, and fall back to text extraction below.
  let resolvedDeadline: string | null = task.deadline ?? null;

  const contents: Content[] = [
    { role: "user", parts: [{ text: systemPrompt(task, now) }] },
  ];

  async function dispatch(call: FunctionCall): Promise<Record<string, unknown>> {
    const args = (call.args ?? {}) as Record<string, unknown>;
    switch (call.name) {
      case "decompose_task": {
        const result = await decompose({
          title: String(args.title ?? task.title),
          deadline: args.deadline ? String(args.deadline) : task.deadline,
          type: args.type ? String(args.type) : task.type,
          context: args.context ? String(args.context) : task.context,
          now,
          timezone: task.timezone,
          contextSummary,
        });
        subtasks.splice(0, subtasks.length, ...result.subtasks);
        recommendation = result.recommendation;
        // (2) If the model surfaced a deadline in its tool call, capture it (unless the
        // user already gave one). Accept only a parseable ISO instant.
        if (!resolvedDeadline && args.deadline) {
          const d = String(args.deadline).trim();
          if (d && !Number.isNaN(new Date(d).getTime())) resolvedDeadline = d;
        }
        return { subtasks: result.subtasks };
      }
      case "get_calendar_conflicts": {
        const busy = await getCalendarConflicts(
          credentials,
          String(args.start_iso),
          String(args.end_iso),
        );
        return { busy };
      }
      case "create_calendar_block": {
        // Staged, not created — the real event waits for the confirm route.
        blocks.push({
          title: String(args.title),
          start_iso: String(args.start_iso),
          end_iso: String(args.end_iso),
          description: args.description ? String(args.description) : undefined,
          subtask: args.subtask ? String(args.subtask) : undefined,
          reason: args.reason ? String(args.reason) : undefined,
        });
        return { status: "staged", note: "Block proposed; awaiting user confirmation." };
      }
      case "draft_email": {
        email = {
          to: String(args.to),
          subject: String(args.subject),
          body: String(args.body),
          reason: args.reason ? String(args.reason) : undefined,
        };
        return { status: "staged", note: "Draft prepared; not sent." };
      }
      default:
        return { error: `Unknown tool: ${call.name}` };
    }
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents,
      config: {
        tools: [{ functionDeclarations: planningTools }],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
        },
      },
    });

    const calls = response.functionCalls;
    if (!calls || calls.length === 0) {
      companionSummary = response.text?.trim() ?? "";
      break;
    }

    // Record the model's tool-call turn, then our responses, so context carries forward.
    const modelTurn = response.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);

    const responseParts: Part[] = [];
    for (const call of calls) {
      const result = await dispatch(call);
      responseParts.push({ functionResponse: { name: call.name ?? "", response: result } });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  if (!companionSummary) {
    companionSummary =
      blocks.length > 0
        ? "Here's a plan to get this done — review the blocks and confirm when you're ready."
        : "I've broken this down for you — take a look.";
  }

  // (3) Still no deadline? Read it straight from the task text as a last resort.
  if (!resolvedDeadline) {
    try {
      resolvedDeadline = await extractDeadline(task.title, now, task.timezone);
    } catch (e) {
      console.warn("[plan] deadline extraction failed:", e);
    }
  }

  return { subtasks, blocks, email, companionSummary, recommendation, deadline: resolvedDeadline };
}
