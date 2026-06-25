import { Type } from "@google/genai";
import { generateContentWithRetry } from "./client";
import { wallClockToInstantIso, instantToWallClock } from "@/lib/time";
import type { FinalizeItem } from "@/lib/types";

export interface ReplanArgs {
  taskTitle: string;
  deadline?: string | null;
  /** The user's plain-language change, e.g. "do this tomorrow morning". */
  instruction: string;
  /** The plan as it currently stands on the proposal screen. */
  items: FinalizeItem[];
  /** Current instant (ISO) — the floor no scheduled slot may fall below. */
  now: string;
  timezone: string;
}

export interface ReplanResult {
  items: FinalizeItem[];
  /** One warm sentence in the companion's voice describing what changed. */
  note: string;
}

const QUARTER_MS = 15 * 60000;

/** now + 30 min, rounded up to the next 15-minute boundary. */
function nextReasonableSlot(nowMs: number): Date {
  const base = nowMs + 30 * 60000;
  return new Date(Math.ceil(base / QUARTER_MS) * QUARTER_MS);
}

/** Turn a current item into a "HH:mm on Mon Jun 25" style line for the prompt. */
function describeItem(it: FinalizeItem): string {
  const when = it.start ? it.start.slice(0, 16).replace("T", " ") : "(no time yet)";
  return `- ${it.title} — ${when}, ${it.effortMinutes} min`;
}

/**
 * Revise an in-flight plan from a natural-language instruction (§4: the companion
 * adjusts the plan conversationally, it doesn't make the user hand-edit every field).
 * A single Gemini structured-output call — the proposal isn't persisted until confirm,
 * so this is a pure transform of the items the user is currently looking at.
 */
export async function replan(args: ReplanArgs): Promise<ReplanResult> {
  const nowLocal = instantToWallClock(new Date(args.now), args.timezone);

  const prompt = [
    "You are Cadence, a calm productivity companion. The user is reviewing a proposed plan",
    "and wants to change it. Apply their instruction and return the revised plan.",
    "",
    `Current local time: ${nowLocal} (timezone ${args.timezone}).`,
    args.deadline ? `Deadline: ${args.deadline}.` : "No hard deadline.",
    "",
    "Rules for the revised plan:",
    "- Keep the same steps and their order unless the instruction clearly asks to add, drop,",
    "  rename, or reorder them.",
    "- Schedule each step in genuinely sensible local time: within ~09:00-21:00, never in the",
    "  past, finishing before the deadline if there is one. Leave short gaps between blocks.",
    "- A step may be left unscheduled (empty start) if the instruction implies it.",
    "- `start` is local wall-clock time formatted EXACTLY as YYYY-MM-DDTHH:mm (24-hour), or an",
    "  empty string if the step has no time. `duration_minutes` is whole minutes.",
    "",
    `Task: ${args.taskTitle}`,
    "Current plan:",
    args.items.map(describeItem).join("\n"),
    "",
    `Instruction: ${args.instruction}`,
    "",
    "Also write `note`: ONE warm, plain sentence telling the user what you changed. No prefix,",
    "no emoji.",
  ].join("\n");

  const response = await generateContentWithRetry({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                start: { type: Type.STRING },
                duration_minutes: { type: Type.INTEGER },
              },
              required: ["title", "start", "duration_minutes"],
            },
          },
          note: { type: Type.STRING },
        },
        required: ["items", "note"],
      },
    },
  });

  const text = response.text ?? "{}";
  let parsed: {
    items?: Array<{ title?: string; start?: string; duration_minutes?: number }>;
    note?: string;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`replan returned invalid JSON: ${text.slice(0, 200)}`);
  }

  const nowMs = new Date(args.now).getTime();

  const items: FinalizeItem[] = (parsed.items ?? [])
    .map((raw): FinalizeItem | null => {
      const title = String(raw.title ?? "").trim();
      const duration = Math.max(15, Number(raw.duration_minutes) || 30);
      const startRaw = String(raw.start ?? "").trim();

      if (!title) return null;
      if (!startRaw) {
        return { title, effortMinutes: duration, start: null, end: null };
      }

      // Resolve the model's local wall-clock to an instant in the user's zone, then
      // shift any already-past slot forward to the next reasonable opening (the model
      // sometimes hands back times that have just elapsed).
      let startInstant = new Date(wallClockToInstantIso(startRaw, args.timezone));
      if (Number.isNaN(startInstant.getTime()) || startInstant.getTime() < nowMs) {
        startInstant = nextReasonableSlot(nowMs);
      }
      const endInstant = new Date(startInstant.getTime() + duration * 60000);

      return {
        title,
        effortMinutes: duration,
        start: instantToWallClock(startInstant, args.timezone),
        end: instantToWallClock(endInstant, args.timezone),
      };
    })
    .filter((it): it is FinalizeItem => it !== null);

  return { items, note: String(parsed.note ?? "").trim() };
}
