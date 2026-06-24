import type { DashboardSubtask, DashboardTask } from "@/lib/types";
import { urgencyRank } from "@/lib/urgency";

const CALM = "You're on track. Nothing needs you right now.";

function hoursLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  return Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 3600000));
}

function countWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five"][n] ?? String(n);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Names the one incomplete subtask that actually moves the needle for a given
 * task type — so even a brand-new kind of task gets a specific, human nudge
 * rather than a generic "you have things to do". Pure keyword matching on the
 * task type/title plus the remaining subtasks; returns a lowercase clause that
 * slots into the escalation sentence, or null to fall back to the generic line.
 */
function priorityHint(type: string, title: string, incomplete: DashboardSubtask[]): string | null {
  const hay = `${type} ${title}`.toLowerCase();
  const has = (re: RegExp) => incomplete.some((s) => re.test(s.title));

  // Interview — a mock run-through beats re-reading notes.
  if (/interview|screening/.test(hay)) {
    const hasMock = has(/mock|run-through|practice|aloud/i);
    const hasNotes = has(/note|review|read/i);
    if (hasMock && hasNotes) return "the mock run-through matters more than re-reading notes right now";
    if (hasMock) return "the mock run-through is the thing that moves the needle";
    return null;
  }

  // Exam prep — active recall beats passive re-reading.
  if (/exam|midterm|finals?\b|quiz|test prep/.test(hay)) {
    const hasPractice = has(/practice|problem|past paper|mock|solve|recall|flashcard/i);
    const hasRead = has(/read|review|notes|revise|chapter/i);
    if (hasPractice && hasRead) return "active recall beats re-reading — start with a practice set";
    if (hasPractice) return "a practice set now will tell you what you actually know";
    return null;
  }

  // Pitch deck — the narrative carries the room, not the slide polish.
  if (/pitch|deck|slides?\b/.test(hay)) {
    const hasStory = has(/story|narrative|outline|script|message|arc/i);
    const hasVisual = has(/design|visual|slide|format|polish|animation/i);
    if (hasStory && hasVisual) return "the story arc matters more than the visuals right now";
    if (hasStory) return "lock the story first — the slides follow from it";
    return null;
  }

  // Meeting prep — the agenda is what makes it land.
  if (/meeting|standup|stand-up|sync|1:1|one-on-one/.test(hay)) {
    if (has(/agenda|talking point|outline/i)) return "the agenda is what makes the meeting land — start there";
    return null;
  }

  // Client work — ship the deliverable, polish later.
  if (/client|deliverable|freelance/.test(hay)) {
    if (has(/draft|build|deliver|send|ship|complete/i))
      return "ship the core deliverable first; polish once it's in their hands";
    return null;
  }

  // Project / status update — lead with what changed.
  if (/project update|status update|progress update|weekly update|standup report/.test(hay)) {
    if (has(/summary|highlight|written|write|draft/i)) return "lead with what changed — keep the how brief";
    return null;
  }

  // Report (internship / lab / project) — get the draft down first.
  if (/report|write-?up|documentation/.test(hay)) {
    const hasDraft = has(/draft|write|content|body|results/i);
    const hasFormat = has(/format|proofread|polish|cite|references|layout/i);
    if (hasDraft && hasFormat) return "get the draft down first — formatting is the easy part";
    if (hasDraft) return "a rough full draft beats a perfect half";
    return null;
  }

  // Reading / chapter — one focused pass.
  if (/reading|chapter|textbook|\bpaper\b|article/.test(hay)) {
    return "one focused pass beats three distracted ones";
  }

  // Bills / fees — a quick, low-effort clear.
  if (/bill|fee|rent|payment|invoice|recharge/.test(hay)) {
    return "this is a five-minute job — log in and clear it before it slips";
  }

  return null;
}

/**
 * A specific, block-aware, task-type-aware escalation line (§3). Pure templates,
 * no Gemini — keeps escalation free and fast while feeling personal.
 */
function escalationMessage(task: DashboardTask): string {
  const incomplete = task.subtasks.filter((s) => s.status !== "done");
  const n = incomplete.length;
  const hasBlock = task.blocks.length > 0;
  const type = (task.type ?? "").toLowerCase();
  const title = task.title;
  const h = hoursLeft(task.deadline);

  switch (task.urgency) {
    case "critical": {
      const due = h === null ? "very soon" : h <= 0 ? "overdue" : `in ${h} ${h === 1 ? "hour" : "hours"}`;
      const need = n > 0 ? ` and ${countWord(n)} ${n === 1 ? "thing" : "things"} still need you` : "";
      const base = `Your ${title} is ${due}${need}.`;
      const hint = priorityHint(type, title, incomplete);
      if (hasBlock) {
        return hint ? `${base} ${cap(hint)} — your block's set, so dive in.` : `${base} Your block's set — dive in.`;
      }
      return hint
        ? `${base} ${cap(hint)} — want me to block the next hour?`
        : `${base} Want me to block the next hour?`;
    }

    case "action-needed": {
      const due = h === null ? "due soon" : h < 12 ? `due in ${h} hours` : "due tomorrow";
      if (hasBlock) {
        return `Your ${title} is ${due}. You have a block scheduled — if you stick to it, you'll finish with time to review.`;
      }
      const left = n > 0 ? ` ${cap(countWord(n))} ${n === 1 ? "thing" : "things"} left to do.` : "";
      const hint = priorityHint(type, title, incomplete);
      if (hint) return `Your ${title} is ${due}.${left} ${cap(hint)} — want me to block time for it?`;
      return `Your ${title} is ${due}.${left} Want me to block time for it?`;
    }

    case "heads-up": {
      const days = h !== null ? Math.max(1, Math.round(h / 24)) : null;
      const due = days ? `${days} ${days === 1 ? "day" : "days"} out` : "coming up";
      const notStarted =
        task.subtasks.length > 0 && task.subtasks.every((s) => s.status !== "done");
      if (notStarted) {
        return `Your ${title} is ${due} and hasn't been started. Even 30 minutes today makes the deadline feel manageable.`;
      }
      return `Heads-up: your ${title} is ${due}. Worth a look while there's still room.`;
    }

    default:
      return CALM;
  }
}

/**
 * One warm, specific sentence about the single most urgent task — the companion's
 * voice (§11). Pure + server-safe: computed from the task list and returned in the
 * API payload so the banner and cards update from one state change.
 */
export function companionMessage(tasks: DashboardTask[]): string {
  const top = [...tasks].sort((a, b) => urgencyRank(b.urgency) - urgencyRank(a.urgency))[0];
  if (!top || urgencyRank(top.urgency) === 0) return CALM;
  return escalationMessage(top);
}
