// Shared reminder urgency math — the SINGLE source of truth for both the in-app
// state (frontend, unit 1) and the escalation email engine (Deno Edge Function, unit 2).
//
// PURE and dependency-free on purpose: no "@/" path alias, no Node/Next imports, all
// types declared locally, and `now` is passed in (never read from the clock here) so it
// stays deterministic and importable from both the Next app and the Deno runtime.

export type ReminderStakes = "low" | "medium" | "critical";
export type ReminderStatus = "active" | "acknowledged" | "snoozed" | "done";
/** Mirrors lib/types `Urgency` so the existing URGENCY_STYLE tokens render reminders. */
export type ReminderTier = "none" | "heads-up" | "action-needed" | "critical";

export interface ReminderUrgencyInput {
  stakes: ReminderStakes;
  deadline: string | null;
  now: number; // epoch ms
  status: ReminderStatus;
  snoozedUntil?: string | null;
}

export interface ReminderUrgency {
  tier: ReminderTier;
  /** Whether the escalation engine should chase this reminder now (unit 2 uses this). */
  shouldChase: boolean;
  hoursLeft: number | null;
}

/**
 * Hours-before-deadline at which each tier first applies, per stakes level. Stakes
 * drive how EARLY urgency ramps: critical begins 3 days out, medium 2, low 1.
 * This table is the single tunable knob shared by in-app state and email chasing.
 */
const THRESHOLDS: Record<
  ReminderStakes,
  { headsUp: number; actionNeeded: number; critical: number }
> = {
  critical: { headsUp: 72, actionNeeded: 24, critical: 6 },
  medium: { headsUp: 48, actionNeeded: 12, critical: 3 },
  low: { headsUp: 24, actionNeeded: 6, critical: 1 },
};

export function reminderUrgency(input: ReminderUrgencyInput): ReminderUrgency {
  const { stakes, deadline, now, status, snoozedUntil } = input;
  const hrs = hoursLeft(deadline, now);

  // Acknowledged or done — the user has it handled; never chase.
  if (status === "acknowledged" || status === "done") {
    return { tier: "none", shouldChase: false, hoursLeft: hrs };
  }

  // Snoozed and still within the snooze window — stay quiet until it lapses.
  if (status === "snoozed" && snoozedUntil) {
    const until = new Date(snoozedUntil).getTime();
    if (!Number.isNaN(until) && now < until) {
      return { tier: "none", shouldChase: false, hoursLeft: hrs };
    }
  }

  if (hrs === null) return { tier: "none", shouldChase: false, hoursLeft: null };

  // A passed deadline is always the loudest state, whatever the stakes.
  if (hrs <= 0) return { tier: "critical", shouldChase: true, hoursLeft: hrs };

  const t = THRESHOLDS[stakes];
  let tier: ReminderTier = "none";
  if (hrs <= t.headsUp) tier = "heads-up";
  if (hrs <= t.actionNeeded) tier = "action-needed";
  if (hrs <= t.critical) tier = "critical";

  return { tier, shouldChase: tier !== "none", hoursLeft: hrs };
}

function hoursLeft(deadline: string | null, now: number): number | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime();
  if (Number.isNaN(ms)) return null;
  return (ms - now) / 3600000;
}
