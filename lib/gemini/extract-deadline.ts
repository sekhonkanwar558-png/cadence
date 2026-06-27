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
    "Resolve all relative dates against that current time and zone.",
    "",
    "Rules:",
    "- 'this week' = the END of the current calendar week: this coming Sunday at 23:59 local time. NOT next Friday.",
    "- BUT if today is already Saturday or Sunday, 'this week' = TODAY at 23:59 local time.",
    "- 'next week' = the FOLLOWING Sunday at 23:59 local time.",
    "- A weekday name ('Friday', 'by Friday') = the next occurrence of that weekday on or after today.",
    "- 'tomorrow' = the next calendar day; 'by EOD'/'today' = today.",
    "- When a date is given with no time of day, use 23:59 local that day.",
    "- Return `deadline` as an ISO 8601 timestamp WITH the user's UTC offset for that instant.",
    "- If the text implies no deadline at all, return an empty string.",
    "",
    "Examples (assume Current time: 2026-06-24T10:00:00+05:30 — a Wednesday — timezone Asia/Kolkata):",
    '- "Submit expense report this week" -> {"deadline":"2026-06-28T23:59:00+05:30"}',
    '- "Finish the slides by Friday" -> {"deadline":"2026-06-26T23:59:00+05:30"}',
    '- "Call the vendor tomorrow" -> {"deadline":"2026-06-25T23:59:00+05:30"}',
    '- "Plan the offsite next week" -> {"deadline":"2026-07-05T23:59:00+05:30"}',
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
