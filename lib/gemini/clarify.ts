import { Type } from "@google/genai";
import { generateContentWithRetry } from "./client";

/**
 * Layer C: decide whether a freshly-typed task is genuinely vague — missing ONE
 * piece of information that would meaningfully change how Cadence plans it — and if
 * so, return ONE perceptive question that proves it already understood the task.
 * A tiny structured call (mirrors extract-deadline). Returns the question, or null
 * when the task is clear enough to plan directly.
 */
export async function assessClarity(
  title: string,
  now: string,
  timezone: string,
): Promise<string | null> {
  const prompt = [
    "You are Cadence, a calm, perceptive productivity companion.",
    `Current time: ${now} (timezone ${timezone}).`,
    "",
    "A user just gave you this task. Decide whether you have enough to plan it WELL, or whether ONE",
    "missing piece of information would meaningfully change how you'd break it down or schedule it.",
    "",
    "Ask ONLY if the task is genuinely vague (e.g. 'prepare for meeting' — slides vs talking points;",
    "'work on project' — what stage). If it already names a subject, a concrete deliverable, a clear",
    "action, or what's hard, do NOT ask — set needs_clarification false.",
    "",
    "If you ask, the question MUST prove you already understood the task:",
    "- reference the specific thing they wrote;",
    "- give the concrete reason it matters to the plan ('that changes whether prep is slides or",
    "  talking points');",
    "- answerable in one short sentence. Exactly ONE question.",
    "NEVER ask generic questions ('Can you tell me more?', 'What are your goals?', 'Provide details')",
    "— a generic question is worse than none; return needs_clarification false instead.",
    "",
    'Good: "Is this a presentation or more of a discussion? That changes whether prep is about',
    'slides or talking points."',
    'Good: "What\'s the part you\'re most worried about? I\'ll give it its own focused block."',
    "",
    `Task: ${title}`,
  ].join("\n");

  const response = await generateContentWithRetry({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          needs_clarification: { type: Type.BOOLEAN },
          question: { type: Type.STRING },
        },
        required: ["needs_clarification", "question"],
      },
    },
  });

  return parseClarity(response.text);
}

/** Validate the model's clarity verdict: a real question when needed, else null. */
export function parseClarity(text: string | undefined): string | null {
  try {
    const parsed = JSON.parse(text ?? "{}") as {
      needs_clarification?: boolean;
      question?: string | null;
    };
    if (!parsed.needs_clarification) return null;
    const q = typeof parsed.question === "string" ? parsed.question.trim() : "";
    return q || null;
  } catch {
    return null;
  }
}
