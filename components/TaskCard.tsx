"use client";

import type { DashboardTask } from "@/lib/types";
import { URGENCY_STYLE } from "@/lib/urgency";
import { formatRelativeDeadline } from "@/lib/format";

interface Props {
  task: DashboardTask;
  onOpen: (task: DashboardTask) => void;
  completionPrompt?: boolean;
  completing?: boolean;
  onComplete?: () => void;
  onDismissComplete?: () => void;
}

const CARD =
  "flex w-full flex-col gap-3 rounded-2xl border border-border bg-surface px-5 py-4 text-left";

export default function TaskCard({
  task,
  onOpen,
  completionPrompt = false,
  completing = false,
  onComplete,
  onDismissComplete,
}: Props) {
  const total = task.subtasks.length;
  const done = task.subtasks.filter((s) => s.status === "done").length;
  const badge = URGENCY_STYLE[task.urgency];

  const summary = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium text-text">{task.title}</span>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>{formatRelativeDeadline(task.deadline)}</span>
        {total > 0 && (
          <span>
            {done} of {total} done
          </span>
        )}
      </div>
    </>
  );

  // The companion noticing a finished task — a calm inline ask, not a system dialog.
  if (completionPrompt) {
    return (
      <div className={CARD}>
        {summary}
        <div className="mt-1 flex flex-col gap-3 border-t border-border pt-3">
          <p className="voice text-base text-text">All done — move to history?</p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onComplete}
              disabled={completing}
              className="rounded-xl bg-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {completing ? "Filing it away…" : "Yes, complete it"}
            </button>
            <button
              type="button"
              onClick={onDismissComplete}
              className="text-sm text-muted transition-colors hover:text-text"
            >
              Keep it open
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => onOpen(task)}
      className={`group ${CARD} transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30`}
    >
      {summary}
    </button>
  );
}
