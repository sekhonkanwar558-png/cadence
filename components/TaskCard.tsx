"use client";

import type { DashboardTask } from "@/lib/types";
import { URGENCY_STYLE } from "@/lib/urgency";
import { formatRelativeDeadline } from "@/lib/format";

interface Props {
  task: DashboardTask;
  onOpen: (task: DashboardTask) => void;
}

export default function TaskCard({ task, onOpen }: Props) {
  const total = task.subtasks.length;
  const done = task.subtasks.filter((s) => s.status === "done").length;
  const badge = URGENCY_STYLE[task.urgency];

  return (
    <button
      onClick={() => onOpen(task)}
      className="group flex w-full flex-col gap-3 rounded-2xl border border-border bg-surface px-5 py-4 text-left transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
    >
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
    </button>
  );
}
