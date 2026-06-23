import type { FunctionDeclaration } from "@google/genai";

/**
 * The agent's tool set (§8). Tools that touch the outside world
 * (`create_calendar_block`, `draft_email`) are STAGED in the propose phase —
 * collected, not executed — and only carried out after the user confirms.
 * Read/in-app tools (`decompose_task`, `get_calendar_conflicts`) run for real.
 */

export const decomposeTask: FunctionDeclaration = {
  name: "decompose_task",
  description:
    "Break the user's task into a short, ordered list of concrete subtasks with effort " +
    "estimates. Call this FIRST, before scheduling anything, so you know the work involved.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "The task title." },
      deadline: {
        type: "string",
        description: "Deadline as ISO 8601 with offset, if the user gave one.",
      },
      type: {
        type: "string",
        description: "Task category, e.g. 'assignment', 'interview', 'meeting', 'bill'.",
      },
      context: { type: "string", description: "Any extra detail the user provided." },
    },
    required: ["title"],
  },
};

export const getCalendarConflicts: FunctionDeclaration = {
  name: "get_calendar_conflicts",
  description:
    "Return the user's busy intervals between two times so you can place work blocks in free " +
    "time. Call this after decomposing, over the window from now until the deadline.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      start_iso: {
        type: "string",
        description: "Window start, ISO 8601 with offset (usually now).",
      },
      end_iso: {
        type: "string",
        description: "Window end, ISO 8601 with offset (usually the deadline).",
      },
    },
    required: ["start_iso", "end_iso"],
  },
};

export const createCalendarBlock: FunctionDeclaration = {
  name: "create_calendar_block",
  description:
    "Propose a focused work block for a subtask. Call once per work session, placing it in " +
    "free time (avoid the busy intervals) before the deadline. Blocks should be 25-90 minutes " +
    "with short gaps, within roughly 09:00-21:00 the user's local time, never in the past.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short event title, e.g. 'Focus: ER diagram'.",
      },
      start_iso: {
        type: "string",
        description: "Start, ISO 8601 with the user's UTC offset, e.g. 2026-06-26T14:00:00+05:30.",
      },
      end_iso: {
        type: "string",
        description: "End, ISO 8601 with the user's UTC offset.",
      },
      description: {
        type: "string",
        description: "What to work on during this block.",
      },
      subtask: {
        type: "string",
        description: "Which subtask title this block covers.",
      },
      reason: {
        type: "string",
        description: "One short line on why this time was chosen.",
      },
    },
    required: ["title", "start_iso", "end_iso"],
  },
};

export const draftEmail: FunctionDeclaration = {
  name: "draft_email",
  description:
    "Draft an email ONLY if the task clearly implies a communication (e.g. asking a professor " +
    "for an extension, confirming a meeting). The draft is shown to the user for review — it is " +
    "NOT sent. Skip this for tasks that need no email.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient, or a placeholder like 'your professor'." },
      subject: { type: "string", description: "Email subject line." },
      body: { type: "string", description: "Email body, in the user's warm, plain voice." },
      reason: { type: "string", description: "One line on why this email helps." },
    },
    required: ["to", "subject", "body"],
  },
};

/** All tools available to the propose loop. */
export const planningTools: FunctionDeclaration[] = [
  decomposeTask,
  getCalendarConflicts,
  createCalendarBlock,
  draftEmail,
];
