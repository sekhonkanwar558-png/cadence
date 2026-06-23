import type { DashboardTask } from "@/lib/types";
import { urgencyRank } from "@/lib/urgency";

const CALM = "You're on track. Nothing needs you right now.";

function hoursLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  return Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 3600000));
}

function dueIn(deadline: string | null): string {
  const h = hoursLeft(deadline);
  if (h === null) return "due soon";
  if (h < 48) return `due in ${h} ${h === 1 ? "hour" : "hours"}`;
  return `due in ${Math.round(h / 24)} days`;
}

function needClause(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? " 1 thing still needs you." : ` ${count} things still need you.`;
}

/**
 * One warm, plain sentence about the single most urgent task — the companion's
 * voice (§11). Pure + server-safe: computed from the task list and returned in
 * the API payload so the banner and cards update from one state change.
 */
export function companionMessage(tasks: DashboardTask[]): string {
  const top = [...tasks].sort((a, b) => urgencyRank(b.urgency) - urgencyRank(a.urgency))[0];
  if (!top || urgencyRank(top.urgency) === 0) return CALM;

  const incomplete = top.subtasks.filter((s) => s.status !== "done").length;

  switch (top.urgency) {
    case "critical":
      return `Your ${top.title} is critical — ${dueIn(top.deadline)}.${needClause(incomplete)}`;
    case "action-needed":
      return `${top.title} needs you soon — ${dueIn(top.deadline)}.${needClause(incomplete)}`;
    case "heads-up":
      return `Heads-up: ${top.title} is ${dueIn(top.deadline)}. Worth a look.`;
    default:
      return CALM;
  }
}
