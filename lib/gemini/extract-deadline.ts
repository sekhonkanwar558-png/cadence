import { Type } from "@google/genai";
import { generateContentWithRetry } from "./client";

/**
 * Last-resort deadline extraction (§7 step 2): when neither the user nor the
 * decomposition surfaced a deadline, read it straight out of the task text.
 * A single tiny structured call — resolves relative dates ("Friday 5pm",
 * "till 28th June", "by EOD") against the user's local clock. Returns an ISO 8601
 * timestamp with offset, or null when the text implies no deadline.
 */
export async function extractDeadline(
  title: string,
  now: string,
  timezone: string,
): Promise<string | null> {
  const prompt = [
    "Extract the deadline this task text implies, if any.",
    `Current time: ${now}. User's timezone: ${timezone}.`,
    "Resolve relative dates against that current time and zone (e.g. 'Friday', 'tomorrow',",
    "'till 28th June', 'by EOD', 'next week').",
    "Return `deadline` as an ISO 8601 timestamp WITH the user's UTC offset for the deadline",
    "instant. If only a date is given (no time), use 23:59 local that day. If the text implies",
    "no deadline at all, return an empty string.",
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
        properties: { deadline: { type: Type.STRING } },
        required: ["deadline"],
      },
    },
  });

  return parseDeadline(response.text);
}

/** Validate a model-returned deadline string: trimmed ISO that parses, else null. */
export function parseDeadline(text: string | undefined): string | null {
  try {
    const parsed = JSON.parse(text ?? "{}") as { deadline?: string | null };
    const d = typeof parsed.deadline === "string" ? parsed.deadline.trim() : "";
    if (!d) return null;
    return Number.isNaN(new Date(d).getTime()) ? null : d;
  } catch {
    return null;
  }
}
