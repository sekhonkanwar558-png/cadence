"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import CompanionBanner from "@/components/CompanionBanner";
import ProfileMenu from "@/components/ProfileMenu";
import RemindersView from "@/components/RemindersView";
import TaskCard from "@/components/TaskCard";
import TaskDetail from "@/components/TaskDetail";
import NewTaskFlow from "@/components/NewTaskFlow";
import CalendarPanel from "@/components/CalendarPanel";
import HistoryView from "@/components/HistoryView";
import type { DashboardTask, Reminder } from "@/lib/types";

type Mode = "dashboard" | "new-task" | "history";

const CALM = "You're on track. Nothing needs you right now.";

// Shown to first-time users instead of fake demo data — tapping one prefills the
// composer (it does not submit), inviting the user to act rather than browse.
// The first three are one per persona (student / professional / founder) so every
// user type sees something relevant immediately; the rest sit behind "Show more".
const EXAMPLE_TASKS = [
  "Final exam on Friday",
  "Send project update to manager by EOD",
  "Prepare pitch deck for investor meeting Thursday",
  // Student
  "Submit assignment by tomorrow 5pm",
  "Prepare for job interview this week",
  "Complete lab report by Thursday",
  "Study for mid-terms starting Monday",
  // Professional
  "Prepare presentation for client meeting Friday",
  "Review and submit expense report this week",
  "Follow up with team on pending deliverables",
  "Complete performance review by next Wednesday",
  // Entrepreneur / Founder
  "Pay electricity bill this week",
  "Send invoice to client before end of month",
  "Follow up with 3 leads by Friday",
  "File GST return before deadline",
];

// Shown on the signed-out landing page so first-time visitors see what Cadence
// *does* (it acts, it doesn't just remind) before committing to Google sign-in.
const CAPABILITIES = [
  {
    Icon: PencilIcon,
    title: "Tell it what's due",
    body: "Type or speak a task or reminder in plain language. Cadence breaks tasks into steps, schedules focus time, and sets pure deadline reminders — no planning needed.",
  },
  {
    Icon: EyeIcon,
    title: "It watches while you work",
    body: "An autonomous monitor checks your deadlines and reminders in the background and emails you when something needs urgent attention — no app open required.",
  },
  {
    Icon: MessagesIcon,
    title: "Change plans by talking",
    body: "Tell Cadence what changed and it reshapes your schedule and updates your calendar. Or promote a reminder into a full plan with one tap.",
  },
  {
    Icon: BellIcon,
    title: "Reminders that escalate",
    body: "Set a pure deadline — no subtasks, no calendar blocks. Cadence watches it and grows more urgent as the deadline nears, emailing you autonomously when it matters most.",
  },
];

export default function Home() {
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<Mode>("dashboard");
  const [board, setBoard] = useState<"tasks" | "reminders">("tasks");
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [companion, setCompanion] = useState(CALM);
  const [loading, setLoading] = useState(true);
  const [composerSeed, setComposerSeed] = useState("");
  const [showAllExamples, setShowAllExamples] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // When a reminder is promoted via "Plan it", hold its id and only acknowledge it once
  // the task plan is actually confirmed (not on click) — so backing out leaves it intact.
  const [planningReminderId, setPlanningReminderId] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [completionPromptId, setCompletionPromptId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [historyTasks, setHistoryTasks] = useState<DashboardTask[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPayload = (data: { tasks: DashboardTask[]; companionMessage: string }) => {
    setTasks(data.tasks);
    setCompanion(data.companionMessage);
  };

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't load your tasks.");
      applyPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/sync");
      const data = await res.json();
      if (data.ok) setLastSynced(data.lastSynced);
    } catch {
      // Non-critical — the label just stays hidden.
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchTasks();
      fetchSyncStatus();
    }
  }, [status, fetchTasks, fetchSyncStatus]);

  function startWith(seed: string) {
    setComposerSeed(seed);
    setMode("new-task");
  }

  /**
   * The "Plan it" bridge: promote a pure-deadline reminder into the full task planner.
   * We DON'T acknowledge here — only after the plan is confirmed (see NewTaskFlow's
   * onConfirmed below). If the user opens the planner and backs out, the reminder stays
   * exactly as it was.
   */
  function planFromReminder(reminder: Reminder) {
    setPlanningReminderId(reminder.id);
    startWith(reminder.title);
  }

  async function checkDeadlines() {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/escalate/run", { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't check your deadlines.");
      applyPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check your deadlines.");
    } finally {
      setChecking(false);
    }
  }

  async function syncCalendar() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't sync your calendar.");
      applyPayload(data);
      setLastSynced(data.lastSynced);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sync your calendar.");
    } finally {
      setSyncing(false);
    }
  }

  async function toggleSubtask(subtaskId: string, done: boolean) {
    const res = await fetch(`/api/subtasks/${subtaskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error ?? "Couldn't update that step.");
    applyPayload(data);

    // Notice when this just finished a task — close the detail and let the card
    // ask whether to move it to history.
    const parent = (data.tasks as DashboardTask[]).find((t) =>
      t.subtasks.some((s) => s.id === subtaskId),
    );
    if (parent && parent.subtasks.length > 0 && parent.subtasks.every((s) => s.status === "done")) {
      setSelectedId(null);
      setCompletionPromptId(parent.id);
    } else if (parent) {
      setCompletionPromptId((cur) => (cur === parent.id ? null : cur));
    }
  }

  async function completeTask() {
    if (!completionPromptId) return;
    setCompleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${completionPromptId}/complete`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't complete that task.");
      setCompletionPromptId(null);
      await fetchTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't complete that task.");
    } finally {
      setCompleting(false);
    }
  }

  async function openHistory() {
    setMode("history");
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/tasks?status=completed");
      const data = await res.json();
      if (data.ok) setHistoryTasks(data.tasks);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function reschedule() {
    if (!selectedId) return;
    setRescheduling(true);
    setRescheduleError(null);
    try {
      const res = await fetch(`/api/tasks/${selectedId}/reschedule`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't reschedule.");
      const tRes = await fetch("/api/tasks");
      const tData = await tRes.json();
      if (tData.ok) applyPayload(tData);
    } catch (e) {
      setRescheduleError(e instanceof Error ? e.message : "Couldn't reschedule.");
    } finally {
      setRescheduling(false);
    }
  }

  /**
   * Layer 3 — re-plan an active task from a plain-language instruction. The route
   * supersedes the task's future calendar events; we re-fetch so the open detail
   * reflects the new blocks. Returns the companion's note; resets loading + surfaces
   * the reason on failure.
   */
  async function replanTask(instruction: string): Promise<{ note: string }> {
    if (!selectedId) throw new Error("No task selected.");
    setReplanning(true);
    setRescheduleError(null);
    try {
      const res = await fetch(`/api/tasks/${selectedId}/replan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't revise the plan.");
      const tRes = await fetch("/api/tasks");
      const tData = await tRes.json();
      if (tData.ok) applyPayload(tData);
      return { note: String(data.note ?? "") };
    } catch (e) {
      setRescheduleError(e instanceof Error ? e.message : "Couldn't revise the plan.");
      throw e;
    } finally {
      setReplanning(false);
    }
  }

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
      <header className="mb-12 flex items-center justify-between">
        <span className="voice text-lg">Cadence</span>
        {status === "authenticated" && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => (mode === "history" ? setMode("dashboard") : openHistory())}
              className="text-sm text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              {mode === "history" ? "Dashboard" : "History"}
            </button>
            <button
              onClick={() => setCalendarOpen(true)}
              aria-label="Open calendar"
              className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent/40 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <span aria-hidden="true" className="text-base leading-none">📅</span>
              Calendar
            </button>
            <ProfileMenu email={session.user?.email ?? ""} name={session.user?.name} />
          </div>
        )}
      </header>

      {status === "loading" && <p className="text-muted">Loading…</p>}

      {status !== "authenticated" && status !== "loading" && (
        <section className="flex flex-1 flex-col justify-center gap-6">
          <div>
            <h1 className="voice text-4xl leading-tight">The important things, handled.</h1>
            <p className="mt-3 max-w-md text-muted">
              Cadence breaks down what you commit to, finds time for it, and quietly keeps watch as
              deadlines approach — so you only deal with what genuinely needs you.
            </p>
          </div>
          <ul className="flex max-w-lg flex-col gap-3">
            {CAPABILITIES.map(({ Icon, title, body }) => (
              <li
                key={title}
                className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon />
                </span>
                <div>
                  <h2 className="font-medium text-text">{title}</h2>
                  <p className="mt-1 text-sm leading-snug text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
          <button
            onClick={() => signIn("google")}
            className="w-fit rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition-opacity hover:opacity-90"
          >
            Continue with Google
          </button>
          <p className="max-w-sm rounded-lg border border-due-soon/40 bg-due-soon/10 px-3 py-2 text-sm text-text">
            {`You'll see a 'Google hasn't verified this app' warning — this is expected for a hackathon submission. Click Advanced → 'Go to cadence-834242762126.asia-south1.run.app (unsafe)' to continue safely.`}
          </p>
        </section>
      )}

      {status === "authenticated" && mode === "new-task" && (
        <NewTaskFlow
          initialValue={composerSeed}
          onConfirmed={() => {
            // The plan is now real — acknowledge the source reminder (a recurring one
            // rolls forward). Fire-and-forget; the reminders tab re-fetches on return.
            if (planningReminderId) {
              fetch(`/api/reminders/${planningReminderId}/acknowledge`, { method: "POST" }).catch(
                () => {},
              );
            }
          }}
          onClose={() => {
            setComposerSeed("");
            setPlanningReminderId(null);
            setMode("dashboard");
            fetchTasks();
          }}
        />
      )}

      {status === "authenticated" && mode === "history" && (
        <HistoryView
          tasks={historyTasks}
          loading={historyLoading}
          onBack={() => setMode("dashboard")}
        />
      )}

      {status === "authenticated" && mode === "dashboard" && (
        <section className="flex flex-col gap-8">
          <div className="flex w-fit items-center gap-1 rounded-xl border border-border bg-surface p-1">
            <button
              onClick={() => setBoard("tasks")}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                board === "tasks" ? "bg-accent/10 text-text" : "text-muted hover:text-text"
              }`}
            >
              Tasks
            </button>
            <button
              onClick={() => setBoard("reminders")}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                board === "reminders" ? "bg-accent/10 text-text" : "text-muted hover:text-text"
              }`}
            >
              Reminders
            </button>
          </div>

          {board === "reminders" ? (
            <RemindersView onPlan={planFromReminder} />
          ) : (
            <>
          <CompanionBanner message={companion} />

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={checkDeadlines}
                disabled={checking}
                className="rounded-xl bg-accent px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {checking ? "Checking…" : "Check my deadlines"}
              </button>
              <button
                onClick={syncCalendar}
                disabled={syncing}
                className="rounded-xl border border-border bg-surface px-4 py-2 transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {syncing ? "Syncing…" : "Sync calendar"}
              </button>
              <button
                onClick={() => startWith("")}
                className="rounded-xl border border-border bg-surface px-4 py-2 transition-colors hover:border-accent/40"
              >
                + New task
              </button>
            </div>
            <p className="text-xs text-muted">Checks approaching deadlines and sends you email nudges.</p>
            {lastSynced && (
              <p className="text-xs text-muted">Calendar synced {relativeTime(lastSynced)}.</p>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-overdue/40 bg-overdue/5 px-4 py-3 text-sm text-overdue">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-muted">Loading your tasks…</p>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col gap-5 py-2">
              <div>
                <p className="voice text-2xl leading-snug">A clear slate.</p>
                <p className="mt-2 max-w-md text-muted">
                  Tell me what you&apos;re working on and I&apos;ll break it down, find time for it,
                  and keep watch. Start with one of these:
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-text">What you can do</p>
                <ul className="flex flex-col gap-2 border-l-2 border-accent/30 pl-4">
                  <li className="text-sm leading-snug text-muted">
                    Type any task — Cadence breaks it into steps and schedules focus time on your
                    calendar.
                  </li>
                  <li className="text-sm leading-snug text-muted">
                    Sync your Google Calendar to import deadlines and meetings automatically.
                  </li>
                  <li className="text-sm leading-snug text-muted">
                    Ask Cadence to adjust your plan in plain language anytime.
                  </li>
                  <li className="text-sm leading-snug text-muted">
                    Set a pure deadline reminder when you just need a nudge — Cadence escalates it on
                    its own as the deadline nears, no plan required.
                  </li>
                  <li className="text-sm leading-snug text-muted">
                    “Check my deadlines” sends you autonomous email nudges when time is running short.
                  </li>
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                {(showAllExamples ? EXAMPLE_TASKS : EXAMPLE_TASKS.slice(0, 3)).map((ex) => (
                  <button
                    key={ex}
                    onClick={() => startWith(ex)}
                    className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                  >
                    {ex}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowAllExamples((v) => !v)}
                className="w-fit text-sm text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              >
                {showAllExamples ? "Show fewer" : "Show more"}
              </button>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {tasks.map((task) => (
                <li key={task.id}>
                  <TaskCard
                    task={task}
                    onOpen={(t) => setSelectedId(t.id)}
                    completionPrompt={completionPromptId === task.id}
                    completing={completing}
                    onComplete={completeTask}
                    onDismissComplete={() => setCompletionPromptId(null)}
                  />
                </li>
              ))}
            </ul>
          )}
            </>
          )}
        </section>
      )}

      {selected && (
        <TaskDetail
          task={selected}
          onClose={() => {
            setSelectedId(null);
            setRescheduleError(null);
          }}
          onReschedule={reschedule}
          rescheduling={rescheduling}
          onReplan={replanTask}
          replanning={replanning}
          rescheduleError={rescheduleError}
          onToggleSubtask={toggleSubtask}
        />
      )}

      {calendarOpen && session?.user?.email && (
        <CalendarPanel email={session.user.email} onClose={() => setCalendarOpen(false)} />
      )}
    </main>
  );
}

/** Compact, friendly "time ago" for the last-synced label. */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Shared base for the landing-page capability icons — Tabler stroke style. */
function CapIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function PencilIcon() {
  return (
    <CapIcon>
      <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
      <path d="M13.5 6.5l4 4" />
    </CapIcon>
  );
}

function EyeIcon() {
  return (
    <CapIcon>
      <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
      <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />
    </CapIcon>
  );
}

function MessagesIcon() {
  return (
    <CapIcon>
      <path d="M21 14l-3 -3h-7a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h9a1 1 0 0 1 1 1v10" />
      <path d="M14 15v2a1 1 0 0 1 -1 1h-7l-3 3v-10a1 1 0 0 1 1 -1h2" />
    </CapIcon>
  );
}

function BellIcon() {
  return (
    <CapIcon>
      <path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 1 7h-6a7 7 0 0 1 1-7" />
      <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
    </CapIcon>
  );
}
