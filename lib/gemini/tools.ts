import type { FunctionDeclaration } from "@google/genai";

/**
 * The only tool Gemini may call on Day 1.
 * Touches the outside world (creates a real Calendar event), so in the full
 * product this routes through a confirm step — for the Day 1 proof we execute
 * directly to verify the path.
 */
export const createCalendarBlock: FunctionDeclaration = {
  name: "create_calendar_block",
  description:
    "Create a focused work block on the user's primary Google Calendar. " +
    "Call this whenever the user wants time set aside for a task. " +
    "Resolve any relative dates/times (e.g. 'tomorrow 2pm') into absolute " +
    "ISO 8601 timestamps that include the user's UTC offset.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short, human event title, e.g. 'Focus: DBMS assignment'.",
      },
      start_iso: {
        type: "string",
        description:
          "Start time as ISO 8601 with a timezone offset, e.g. 2026-06-23T14:00:00+05:30.",
      },
      end_iso: {
        type: "string",
        description:
          "End time as ISO 8601 with a timezone offset, e.g. 2026-06-23T15:00:00+05:30.",
      },
      description: {
        type: "string",
        description: "Optional longer note about what to work on during the block.",
      },
    },
    required: ["title", "start_iso", "end_iso"],
  },
};
