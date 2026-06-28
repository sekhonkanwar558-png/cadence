"use client";

import { useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { useVoiceInput, type VoiceState } from "@/components/useVoiceInput";
import { formatDeadlineHuman, isoToDatetimeLocal } from "@/lib/format";
import type { ReminderRecurrence, ReminderStakes } from "@/lib/types";

type StakesChoice = "auto" | ReminderStakes;
type RecurrenceChoice = "none" | ReminderRecurrence;
type Stage = "capture" | "confirm";

const STAKES_OPTIONS: { value: StakesChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Nice to remember" },
  { value: "medium", label: "Important" },
  { value: "critical", label: "Critical" },
];

// Stage 2 has no "Auto" — by then Cadence has already inferred a concrete stakes.
const CONFIRM_STAKES_OPTIONS = STAKES_OPTIONS.filter(
  (o): o is { value: ReminderStakes; label: string } => o.value !== "auto",
);

const RECURRENCE_OPTIONS: { value: RecurrenceChoice; label: string }[] = [
  { value: "none", label: "One-off" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const INPUT =
  "rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

const STAKES_PILL = (active: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
    active
      ? "border-accent/40 bg-accent/10 text-text"
      : "border-border text-muted hover:border-accent/40"
  }`;

interface Props {
  onCreated: () => void;
}

/**
 * Add a reminder in two calm stages: CAPTURE (type or speak it) → CONFIRM (review what
 * Cadence understood, then save). The manual date picker only appears in the confirm
 * step, so natural language and a picker never fight over the same value.
 */
export default function ReminderComposer({ onCreated }: Props) {
  const { status } = useSession();
  const [stage, setStage] = useState<Stage>("capture");

  // Stage 1 — capture
  const [title, setTitle] = useState("");
  const [stakes, setStakes] = useState<StakesChoice>("auto");
  const [recurrence, setRecurrence] = useState<RecurrenceChoice>("none");
  const [parsing, setParsing] = useState(false);

  // Stage 2 — confirm (inferred values, all editable)
  const [cTitle, setCTitle] = useState("");
  const [cDeadlineLocal, setCDeadlineLocal] = useState(""); // datetime-local; "" = none inferred
  const [cStakes, setCStakes] = useState<ReminderStakes>("medium");
  const [showAdjust, setShowAdjust] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voice = useVoiceInput((text) =>
    setTitle((v) => (v.trim() ? `${v.trim()} ${text}` : text)),
  );

  const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

  function reset() {
    setTitle("");
    setStakes("auto");
    setRecurrence("none");
    setCTitle("");
    setCDeadlineLocal("");
    setCStakes("medium");
    setShowAdjust(false);
    setError(null);
    setStage("capture");
  }

  // Stage 1 → run smart capture, then show the confirm step.
  async function capture(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || parsing) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/reminders/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, timezone: timezone() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't read that. Try again?");
      setCTitle(typeof data.title === "string" && data.title.trim() ? data.title.trim() : t);
      const local = data.deadline ? isoToDatetimeLocal(data.deadline) : "";
      setCDeadlineLocal(local);
      setShowAdjust(!local); // no deadline inferred → reveal the picker so they can set one
      setCStakes(stakes === "auto" ? (data.stakes as ReminderStakes) ?? "medium" : stakes);
      setStage("confirm");
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Something went wrong.");
    } finally {
      setParsing(false);
    }
  }

  // Stage 2 → save the confirmed reminder.
  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!cTitle.trim() || !cDeadlineLocal || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reminders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: cTitle.trim(),
          deadline: `${cDeadlineLocal}:00`,
          stakes: cStakes,
          recurrence: recurrence === "none" ? undefined : recurrence,
          timezone: timezone(),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't save that reminder.");
      reset();
      onCreated();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  if (stage === "confirm") {
    const repeatLabel =
      recurrence !== "none"
        ? RECURRENCE_OPTIONS.find((o) => o.value === recurrence)?.label
        : null;

    return (
      <form
        onSubmit={confirm}
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface px-4 py-4"
      >
        <p className="voice text-lg">Here&apos;s what I caught</p>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Reminder</span>
          <input
            value={cTitle}
            onChange={(e) => setCTitle(e.target.value)}
            aria-label="Reminder"
            className={INPUT}
          />
        </label>

        <div className="flex flex-col gap-1">
          {cDeadlineLocal ? (
            <>
              <span className="text-xs text-muted">Due</span>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-text">{formatDeadlineHuman(cDeadlineLocal)}</span>
                <button
                  type="button"
                  onClick={() => setShowAdjust((v) => !v)}
                  className="text-sm text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                >
                  {showAdjust ? "Done" : "Adjust time"}
                </button>
              </div>
            </>
          ) : (
            <span className="text-sm text-text">When is this due?</span>
          )}
          {(showAdjust || !cDeadlineLocal) && (
            <input
              type="datetime-local"
              value={cDeadlineLocal}
              onChange={(e) => setCDeadlineLocal(e.target.value)}
              aria-label="Deadline"
              className={`mt-1 w-fit ${INPUT}`}
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Stakes</span>
          <div className="flex flex-wrap items-center gap-2">
            {CONFIRM_STAKES_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setCStakes(o.value)}
                aria-pressed={cStakes === o.value}
                className={STAKES_PILL(cStakes === o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {repeatLabel && <p className="text-xs text-muted">Repeats {repeatLabel.toLowerCase()}.</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={saving || !cTitle.trim() || !cDeadlineLocal}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Set reminder"}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStage("capture");
            }}
            className="rounded-xl border border-border bg-surface px-5 py-2.5 text-sm transition-colors hover:border-accent/40"
          >
            Edit
          </button>
        </div>

        {error && <p className="text-sm text-overdue">{error}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={capture} className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-4">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Remind me to…"
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
            className={STAKES_PILL(stakes === o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-muted">
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
        <button
          type="submit"
          disabled={parsing || !title.trim()}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {parsing ? "Reading…" : "Add reminder"}
        </button>
      </div>

      <p className="text-xs text-muted">
        Just type or speak it — include the date and time (&ldquo;pay bill today at 2pm&rdquo;,
        &ldquo;call dentist Friday 3pm&rdquo;).
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
