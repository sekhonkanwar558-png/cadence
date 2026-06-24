import { Type } from "@google/genai";
import { generateContentWithRetry } from "./client";
import type { Subtask } from "@/lib/types";

export interface DecomposeArgs {
  title: string;
  deadline?: string;
  type?: string;
  context?: string;
  now: string;
  timezone: string;
  /** A short, lightweight summary of the user's history (§4) — may be empty. */
  contextSummary?: string;
}

export interface DecomposeResult {
  subtasks: Subtask[];
  /** One sharp, context-aware insight in the companion's voice (§2). */
  recommendation: string;
}

/**
 * The decompose_task handler: a focused Gemini structured-output call that
 * returns ordered subtasks with effort estimates AND a single personalized
 * recommendation (§2/§3) — one call, no extra round-trip.
 */
export async function decompose(args: DecomposeArgs): Promise<DecomposeResult> {
  const prompt = [
    "You are Cadence, a calm productivity companion.",
    `The current time is ${args.now} (timezone ${args.timezone}).`,
    `Break this task into a short, ordered list of concrete subtasks a person can actually start.`,
    `Estimate focused effort in minutes for each. Be realistic and minimal — prefer 3-6 subtasks,`,
    `no padding. Order by dependency (what must happen first gets the lowest order).`,
    "",
    "Then write ONE sharp, specific insight (a single sentence) that would genuinely help this",
    "person — grounded in the task type, how close the deadline is, the subtasks you created, and",
    "the time of day. Write it the way a thoughtful friend would speak, warm and plain. No prefix,",
    "no emoji, no 'Tip:'. Just the sentence.",
    "",
    `Task: ${args.title}`,
    args.type ? `Type: ${args.type}` : "",
    args.deadline ? `Deadline: ${args.deadline}` : "",
    args.context ? `Context: ${args.context}` : "",
    args.contextSummary ? `About this user: ${args.contextSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await generateContentWithRetry({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          subtasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                effort_minutes: { type: Type.INTEGER },
                order: { type: Type.INTEGER },
              },
              required: ["title", "effort_minutes", "order"],
            },
          },
          recommendation: { type: Type.STRING },
        },
        required: ["subtasks", "recommendation"],
      },
    },
  });

  const text = response.text ?? "{}";
  let parsed: { subtasks?: Subtask[]; recommendation?: string };
  try {
    parsed = JSON.parse(text) as { subtasks?: Subtask[]; recommendation?: string };
  } catch {
    throw new Error(`decompose_task returned invalid JSON: ${text.slice(0, 200)}`);
  }

  const subtasks = (parsed.subtasks ?? [])
    .map((s, i) => ({
      title: String(s.title),
      effort_minutes: Number(s.effort_minutes) || 30,
      order: Number.isFinite(s.order) ? Number(s.order) : i + 1,
    }))
    .sort((a, b) => a.order - b.order);

  return { subtasks, recommendation: String(parsed.recommendation ?? "").trim() };
}
