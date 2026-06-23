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
}

/**
 * The decompose_task handler: a focused Gemini structured-output call that
 * returns ordered subtasks with effort estimates (§3 / §8). Separate from the
 * planning loop so the schema is strictly enforced.
 */
export async function decompose(args: DecomposeArgs): Promise<Subtask[]> {
  const prompt = [
    "You are Cadence, a calm productivity companion.",
    `The current time is ${args.now} (timezone ${args.timezone}).`,
    `Break this task into a short, ordered list of concrete subtasks a person can actually start.`,
    `Estimate focused effort in minutes for each. Be realistic and minimal — prefer 3-6 subtasks,`,
    `no padding. Order by dependency (what must happen first gets the lowest order).`,
    "",
    `Task: ${args.title}`,
    args.type ? `Type: ${args.type}` : "",
    args.deadline ? `Deadline: ${args.deadline}` : "",
    args.context ? `Context: ${args.context}` : "",
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
        },
        required: ["subtasks"],
      },
    },
  });

  const text = response.text ?? "{}";
  let parsed: { subtasks?: Subtask[] };
  try {
    parsed = JSON.parse(text) as { subtasks?: Subtask[] };
  } catch {
    throw new Error(`decompose_task returned invalid JSON: ${text.slice(0, 200)}`);
  }

  const subtasks = (parsed.subtasks ?? []).map((s, i) => ({
    title: String(s.title),
    effort_minutes: Number(s.effort_minutes) || 30,
    order: Number.isFinite(s.order) ? Number(s.order) : i + 1,
  }));

  return subtasks.sort((a, b) => a.order - b.order);
}
