"use client";

import { useEffect } from "react";
import type { DashboardTask } from "@/lib/types";
import { URGENCY_STYLE } from "@/lib/urgency";
import { formatRelativeDeadline, formatDayHeading, formatTimeRange } from "@/lib/format";

interface Props {
  task: DashboardTask;
  onClose: () => void;
  onReschedule: () => void;
  rescheduling: boolean;
  rescheduleError: string | null;
}

export default function TaskDetail({
  task,
  onClose,
  onReschedule,
  rescheduling,
  rescheduleError,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const badge = URGENCY_STYLE[task.urgency];
  const incompleteCount = task.subtasks.filter((s) => s.status !== "done").length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-text/20 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-medium">{task.title}</h2>
            <p className="mt-1 text-sm text-muted">{formatRelativeDeadline(task.deadline)}</p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>

        {/* Subtasks */}
        {task.subtasks.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted">The work</h3>
            <ul className="mt-3 flex flex-col gap-2">
              {task.subtasks.map((s) => {
                const done = s.status === "done";
                return (
                  <li key={s.id} className="flex items-center gap-3">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        done ? "bg-border" : "bg-accent"
                      }`}
                    />
                    <span className={done ? "text-muted line-through" : "text-text"}>
                      {s.title}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Scheduled blocks */}
        {task.blocks.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted">Scheduled</h3>
            <ul className="mt-3 flex flex-col gap-2">
              {task.blocks.map((b) => (
                <li
                  key={b.id}
                  className="flex items-baseline justify-between gap-3 rounded-xl border border-border px-4 py-2.5"
                >
                  <span className="text-sm">
                    {formatDayHeading(b.start)} · {formatTimeRange(b.start, b.end)}
                  </span>
                  {b.event_link && (
                    <a
                      href={b.event_link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-accent hover:underline"
                    >
                      Open ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {rescheduleError && (
          <p className="mt-4 text-sm text-overdue">{rescheduleError}</p>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center gap-4">
          {incompleteCount > 0 && (
            <button
              onClick={onReschedule}
              disabled={rescheduling}
              className="rounded-xl bg-accent px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {rescheduling ? "Finding you a slot…" : "Reschedule remaining work"}
            </button>
          )}
          <button onClick={onClose} className="text-muted transition-colors hover:text-text">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
