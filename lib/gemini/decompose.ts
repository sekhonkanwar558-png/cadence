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
  /** Layer B: the user's other commitments + 7-day schedule load — may be empty. */
  scheduleContext?: string;
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
    "",
    "Break this task into the actual steps THIS person needs — not a generic template.",
    "Read what they wrote closely and let the specifics drive the steps:",
    "- Name the real things in the task. If they mention concepts, deliverables, people, or weak",
    "  spots, the steps must reference those by name (e.g. 'Drill tree traversals & BST operations',",
    "  not 'Review material'). A step a stranger could have written is a failed step.",
    "- Use their stated difficulty or priority: give flagged/weak/high-stakes parts their own,",
    "  deeper steps and trim or merge the parts they already seem solid on.",
    "- Vary the number of steps to fit the work: a quick errand may be 2, a real project 6-7.",
    "  Never pad to hit a number, and avoid filler like 'take notes' or 'final review' unless the",
    "  task genuinely calls for it.",
    "- Order so the work flows: dependencies first, and when it helps, put the hardest or most",
    "  important part earlier while energy is highest.",
    "Estimate realistic focused minutes per step.",
    "",
    "Then write ONE recommendation: a single warm, plain sentence that adds something the schedule",
    "summary will NOT already say — a risk to watch, where to start, or what to protect if time",
    "gets tight (e.g. 'Trees carry the most marks here — if one block slips, protect that one').",
    "Ground it in something specific they wrote. Perceptive, not flowery. No prefix, no emoji,",
    "no 'Tip:'.",
    "",
    `Task: ${args.title}`,
    args.type ? `Type: ${args.type}` : "",
    args.deadline ? `Deadline: ${args.deadline}` : "",
    args.context ? `Context: ${args.context}` : "",
    args.contextSummary ? `About this user: ${args.contextSummary}` : "",
    args.scheduleContext ? `What else the user has on: ${args.scheduleContext}` : "",
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
