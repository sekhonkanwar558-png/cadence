"use client";

import { useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { useVoiceInput, type VoiceState } from "@/components/useVoiceInput";
import type { ReminderRecurrence, ReminderStakes } from "@/lib/types";

type StakesChoice = "auto" | ReminderStakes;
type RecurrenceChoice = "none" | ReminderRecurrence;

const STAKES_OPTIONS: { value: StakesChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Nice to remember" },
  { value: "medium", label: "Important" },
  { value: "critical", label: "Critical" },
];

const RECURRENCE_OPTIONS: { value: RecurrenceChoice; label: string }[] = [
  { value: "none", label: "One-off" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const INPUT =
  "rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

interface Props {
  onCreated: () => void;
}

/** Add a reminder — type or speak it; Cadence infers the date + stakes (smart capture). */
export default function ReminderComposer({ onCreated }: Props) {
  const { status } = useSession();
  const [title, setTitle] = useState("");
  const [stakes, setStakes] = useState<StakesChoice>("auto");
  const [recurrence, setRecurrence] = useState<RecurrenceChoice>("none");
  const [deadline, setDeadline] = useState(""); // datetime-local; blank = inferred
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voice = useVoiceInput((text) =>
    setTitle((v) => (v.trim() ? `${v.trim()} ${text}` : text)),
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reminders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t,
          stakes: stakes === "auto" ? undefined : stakes,
          recurrence: recurrence === "none" ? undefined : recurrence,
          deadline: deadline ? `${deadline}:00` : undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't save that reminder.");
      setTitle("");
      setDeadline("");
      setStakes("auto");
      setRecurrence("none");
      onCreated();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-4">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Remind me to… (e.g. electricity bill due Friday)"
          aria-label="Reminder"
          className={`flex-1 ${INPUT}`}
        />
        {status === "authenticated" && (
          <MicButton state={voice.state} onStart={voice.start} onStop={voice.stop} />
        )}
      </div>
      {voice.error && <p className="text-sm text-muted">{voice.error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {STAKES_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setStakes(o.value)}
            aria-pressed={stakes === o.value}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
              stakes === o.value
                ? "border-accent/40 bg-accent/10 text-text"
                : "border-border text-muted hover:border-accent/40"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <label className="flex items-center gap-2">
            <span>Due</span>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              aria-label="Deadline (optional — blank lets Cadence infer it)"
              className={INPUT}
            />
          </label>
          <label className="flex items-center gap-2">
            <span>Repeat</span>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as RecurrenceChoice)}
              aria-label="Recurrence"
              className={INPUT}
            >
              {RECURRENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Add reminder"}
        </button>
      </div>

      <p className="text-xs text-muted">
        Just type or speak it — I&apos;ll infer the date and how much it matters. Override anything above.
      </p>
      {error && <p className="text-sm text-overdue">{error}</p>}
    </form>
  );
}

function MicButton({
  state,
  onStart,
  onStop,
}: {
  state: VoiceState;
  onStart: () => void;
  onStop: () => void;
}) {
  const base =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-surface transition-colors";

  if (state === "transcribing") {
    return (
      <span className={`${base} border-border`} aria-label="Transcribing">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
      </span>
    );
  }

  if (state === "recording") {
    return (
      <button type="button" onClick={onStop} aria-label="Stop recording" className={`${base} border-[#C2554D]/50`}>
        <span className="h-3 w-3 animate-pulse rounded-full bg-[#C2554D]" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      aria-label="Record voice"
      className={`${base} border-border text-muted hover:border-accent/40 hover:text-text`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <line x1="12" y1="18" x2="12" y2="21" />
      </svg>
    </button>
  );
}
