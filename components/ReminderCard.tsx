"use client";

import { useState } from "react";
import type { Reminder, ReminderRecurrence } from "@/lib/types";
import { reminderUrgency, type ReminderStakes } from "@/lib/reminders/urgency";
import { URGENCY_STYLE } from "@/lib/urgency";
import { formatRelativeDeadline } from "@/lib/format";

/** Stakes is the user's importance (a quiet dot); urgency is the computed state (the badge). */
const STAKES_META: Record<ReminderStakes, { label: string; dot: string }> = {
  critical: { label: "Critical", dot: "bg-overdue" },
  medium: { label: "Important", dot: "bg-due-soon" },
  low: { label: "Nice to remember", dot: "bg-on-track" },
};

const RECUR_LABEL: Record<ReminderRecurrence, string> = {
  daily: "Repeats daily",
  weekly: "Repeats weekly",
  monthly: "Repeats monthly",
};

interface Props {
  reminder: Reminder;
  onAcknowledge: (id: string) => void;
  onSnooze: (id: string, snoozedUntil: string) => void;
  onPlan: (reminder: Reminder) => void;
  busy: boolean;
  /** When true, render larger/quieter for the triage hero slot. */
  hero?: boolean;
}

export default function ReminderCard({ reminder, onAcknowledge, onSnooze, onPlan, busy, hero }: Props) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const urgency = reminderUrgency({
    stakes: reminder.stakes,
    deadline: reminder.deadline,
    now: Date.now(),
    status: reminder.status,
    snoozedUntil: reminder.snoozed_until,
  });
  const badge = URGENCY_STYLE[urgency.tier];
  const stakes = STAKES_META[reminder.stakes];
  // Only offer the prominent, permanent "Mark done" when the reminder actually needs
  // attention (critical absorbs overdue). Calm/early ones get a quiet "Dismiss" instead,
  // so they're harder to clear by accident.
  const urgent = urgency.tier === "action-needed" || urgency.tier === "critical";

  function snoozePreset(hours: number) {
    onSnooze(reminder.id, new Date(Date.now() + hours * 3600000).toISOString());
    setSnoozeOpen(false);
  }

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border bg-surface px-5 ${
        hero ? "border-accent/30 py-5" : "border-border py-4"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${stakes.dot}`} aria-hidden="true" />
          <span className={`font-medium text-text ${hero ? "text-lg" : ""}`}>{reminder.title}</span>
        </span>
        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-muted">
        <span>{formatRelativeDeadline(reminder.deadline)}</span>
        <span className="flex items-center gap-2 text-xs">
          {reminder.recurrence && <span>{RECUR_LABEL[reminder.recurrence]}</span>}
          <span>{stakes.label}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
        {urgent ? (
          <button
            type="button"
            onClick={() => onAcknowledge(reminder.id)}
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Mark done
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onAcknowledge(reminder.id)}
            disabled={busy}
            className="text-sm text-muted transition-colors hover:text-text disabled:opacity-40"
          >
            Dismiss
          </button>
        )}

        <button
          type="button"
          onClick={() => onPlan(reminder)}
          disabled={busy}
          className="text-sm text-accent transition-colors hover:underline disabled:opacity-40"
        >
          Plan it
        </button>

        {snoozeOpen ? (
          <span className="flex items-center gap-3 text-sm">
            <button type="button" onClick={() => snoozePreset(3)} disabled={busy} className="text-muted transition-colors hover:text-text disabled:opacity-40">
              Later today
            </button>
            <button type="button" onClick={() => snoozePreset(24)} disabled={busy} className="text-muted transition-colors hover:text-text disabled:opacity-40">
              Tomorrow
            </button>
            <button type="button" onClick={() => setSnoozeOpen(false)} className="text-muted transition-colors hover:text-text">
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setSnoozeOpen(true)}
            disabled={busy}
            className="text-sm text-muted transition-colors hover:text-text disabled:opacity-40"
          >
            Snooze
          </button>
        )}
      </div>
    </div>
  );
}
