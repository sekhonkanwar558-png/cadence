import { Type } from "@google/genai";
import { generateContentWithRetry } from "./client";
import type { ReminderStakes } from "@/lib/types";

export interface ParsedReminder {
  title: string;
  deadline: string | null;
  stakes: ReminderStakes;
}

const STAKES: ReadonlySet<string> = new Set(["low", "medium", "critical"]);

/**
 * Smart capture: read a raw reminder line into clean { title, deadline, stakes } in ONE
 * structured call — so the user can just type or speak "pay electricity bill friday" and
 * Cadence infers the date and how much it matters. The only AI touch in the reminders flow.
 */
export async function parseReminder(
  text: string,
  now: string,
  timezone: string,
): Promise<ParsedReminder> {
  const prompt = [
    "You are Cadence. Turn this raw reminder into structured fields.",
    `Current time: ${now}. User's timezone: ${timezone}.`,
    "",
    "- title: the thing to remember, tidied to a short imperative (e.g. 'Pay the electricity bill').",
    "  Strip any date/time words out of the title.",
    "- deadline: ISO 8601 WITH the user's UTC offset, resolving relative dates ('friday', 'tomorrow',",
    "  '5pm', 'next week') against the current time and zone. If only a date is given (no time), use",
    "  23:59 local that day. If no due date is implied at all, return an empty string.",
    "- stakes: how much it matters — 'low' (nice to remember), 'medium' (important, e.g. a bill or",
    "  form), or 'critical' (serious consequence if missed). Default to 'medium' when unsure.",
    "",
    `Reminder: ${text}`,
  ].join("\n");

  const response = await generateContentWithRetry({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          deadline: { type: Type.STRING },
          stakes: { type: Type.STRING, enum: ["low", "medium", "critical"] },
        },
        required: ["title", "deadline", "stakes"],
      },
    },
  });

  return parseReminderResponse(response.text, text);
}

/** Validate the model's parse, falling back to the raw text + sensible defaults. */
export function parseReminderResponse(
  textJson: string | undefined,
  fallbackTitle: string,
): ParsedReminder {
  try {
    const p = JSON.parse(textJson ?? "{}") as {
      title?: string;
      deadline?: string;
      stakes?: string;
    };
    const title = typeof p.title === "string" && p.title.trim() ? p.title.trim() : fallbackTitle.trim();
    const d = typeof p.deadline === "string" ? p.deadline.trim() : "";
    const deadline = d && !Number.isNaN(new Date(d).getTime()) ? d : null;
    const stakes = (STAKES.has(p.stakes ?? "") ? p.stakes : "medium") as ReminderStakes;
    return { title, deadline, stakes };
  } catch {
    return { title: fallbackTitle.trim(), deadline: null, stakes: "medium" };
  }
}
