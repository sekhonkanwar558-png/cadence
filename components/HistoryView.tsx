"use client";

import type { DashboardTask } from "@/lib/types";
import { formatDayHeading } from "@/lib/format";

interface Props {
  tasks: DashboardTask[];
  loading: boolean;
  onBack: () => void;
}

/** Past, completed tasks — muted to read as "done and behind you". */
export default function HistoryView({ tasks, loading, onBack }: Props) {
  return (
    <section className="flex flex-col gap-6">
      <button
        onClick={onBack}
        className="w-fit text-sm text-muted transition-colors hover:text-text"
      >
        ← Back to dashboard
      </button>

      <h2 className="font-serif text-3xl tracking-tight">History</h2>

      {loading ? (
        <p className="text-muted">Loading your history…</p>
      ) : tasks.length === 0 ? (
        <p className="text-muted">Nothing completed yet — your finished tasks will appear here.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((task) => {
            const completedCount = task.subtasks.filter((s) => s.status === "done").length;
            return (
              <li
                key={task.id}
                className="flex flex-col gap-2 rounded-2xl border border-border bg-surface/60 px-5 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium text-muted">{task.title}</span>
                  {task.completed_at && (
                    <span className="shrink-0 text-xs text-muted/80">
                      {formatDayHeading(task.completed_at)}
                    </span>
                  )}
                </div>
                {task.subtasks.length > 0 && (
                  <span className="text-sm text-muted/80">
                    {completedCount} of {task.subtasks.length}{" "}
                    {task.subtasks.length === 1 ? "step" : "steps"} completed
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
