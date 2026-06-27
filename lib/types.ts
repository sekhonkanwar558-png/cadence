// Shared domain types for Cadence (typed end to end, per §12 — no `any`).

export type TaskStatus = "proposed" | "active" | "completed" | "done" | "cancelled";
export type BlockStatus = "proposed" | "confirmed" | "done" | "cancelled";
export type DraftStatus = "draft" | "confirmed" | "sent";

/** A unit of work produced by decompose_task. */
export interface Subtask {
  title: string;
  effort_minutes: number;
  order: number;
}

/** A work block the agent proposes (staged, not yet on the real calendar). */
export interface ProposedBlock {
  title: string;
  start_iso: string;
  end_iso: string;
  description?: string;
  /** Which subtask this block covers — UI metadata, not sent to Google. */
  subtask?: string;
  /** One-line "why now" — UI metadata. */
  reason?: string;
}

/** A suggested email shown in the proposal (Day 2: not sent; Gmail is Day 4). */
export interface ProposedEmail {
  to: string;
  subject: string;
  body: string;
  reason?: string;
}

/** Busy interval from the Calendar free/busy API. */
export interface BusyBlock {
  start: string;
  end: string;
}

/** The task as the user stated it, parsed by the UI before hitting the agent. */
export interface TaskInput {
  title: string;
  deadline?: string;
  type?: string;
  importance?: number;
  context?: string;
  timezone: string;
}

/** Layer C: one round of clarification — the question asked and the user's answer. */
export interface TaskClarification {
  question: string;
  answer: string;
}

/** Layer C: the plan route's response when a task is too vague to plan yet. */
export interface ClarifyNeeded {
  ok: true;
  needsClarification: true;
  question: string;
}

/** What POST /api/agent/plan returns to the UI. */
export interface PlanResult {
  taskId: string;
  companionSummary: string;
  /** One personalized insight in the companion's voice (§2) — shown above the plan. */
  recommendation?: string;
  task: {
    id: string;
    title: string;
    type: string | null;
    deadline: string | null;
    importance: number;
    status: TaskStatus;
  };
  subtasks: Subtask[];
  blocks: Array<ProposedBlock & { id: string }>;
  emailDraft: (ProposedEmail & { id: string }) | null;
}

/**
 * One edited plan item the proposal screen sends to the finalize/confirm route.
 * `start`/`end` are timezone-naive wall-clock ("YYYY-MM-DDTHH:mm:ss") or null when the
 * step has no scheduled time; the server resolves them with the request's `timezone`.
 */
export interface FinalizeItem {
  title: string;
  effortMinutes: number;
  start: string | null;
  end: string | null;
}

/** A block after the user confirms and it becomes a real Calendar event. */
export interface ConfirmedBlock {
  id: string;
  title: string;
  start: string;
  end: string;
  eventLink: string;
}

// ---- Day 3: escalation + dashboard ----

export type EscalationKind = "heads-up" | "action-needed" | "critical";
export type Urgency = "none" | EscalationKind;

export interface DashboardSubtask {
  id: string;
  title: string;
  status: string; // 'todo' | 'done'
  effort_minutes: number | null;
  order: number;
}

export interface DashboardBlock {
  id: string;
  title: string | null;
  start: string;
  end: string;
  status: string;
  event_link: string | null;
}

export interface DashboardDraft {
  id: string;
  to: string | null;
  subject: string | null;
  body: string | null;
  status: DraftStatus;
  gmail_id: string | null;
}

/** A task as the dashboard renders it — with progress + current urgency. */
export interface DashboardTask {
  id: string;
  title: string;
  type: string | null;
  deadline: string | null;
  status: TaskStatus;
  urgency: Urgency;
  importance: number;
  is_demo: boolean;
  completed_at: string | null;
  /** 'cadence' (user-created) | 'google_calendar' (imported via sync). */
  source: string;
  /** 'task' | 'deadline' | 'meeting' — drives the imported-item tag. */
  event_type: string;
  subtasks: DashboardSubtask[];
  blocks: DashboardBlock[];
  drafts: DashboardDraft[];
}

/** Shared payload shape for the dashboard endpoints. */
export interface DashboardPayload {
  ok: true;
  tasks: DashboardTask[];
  companionMessage: string;
}
