"use client";

import { useEffect, useState } from "react";
import type { DashboardTask } from "@/lib/types";
import { URGENCY_STYLE } from "@/lib/urgency";
import { formatRelativeDeadline, formatDayHeading, formatTimeRange } from "@/lib/format";
import { useVoiceInput } from "@/components/useVoiceInput";
import MicButton from "@/components/MicButton";
import EmailDraftCard from "@/components/EmailDraftCard";

interface Props {
  task: DashboardTask;
  onClose: () => void;
  /** Re-plan this active task from a plain-language instruction; resolves with a note. */
  onReplan: (instruction: string) => Promise<{ note: string }>;
  replanning: boolean;
  rescheduleError: string | null;
  onToggleSubtask: (subtaskId: string, done: boolean) => Promise<void>;
}

export default function TaskDetail({
  task,
  onClose,
  onReplan,
  replanning,
  rescheduleError,
  onToggleSubtask,
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  /**
   * The companion's note from the latest revision — shown prominently, then faded.
   * Carries an id so an identical note still re-triggers the entrance + timer.
   */
  const [note, setNote] = useState<{ text: string; id: number } | null>(null);
  const [noteShown, setNoteShown] = useState(false);

  const busy = replanning;

  // Voice for the conversational adjust — appends transcription to the instruction.
  const voice = useVoiceInput((text) =>
    setInstruction((v) => (v.trim() ? `${v.trim()} ${text}` : text)),
  );

  async function submitReplan() {
    const text = instruction.trim();
    if (!text || busy) return;
    try {
      const { note: revisedNote } = await onReplan(text);
      setInstruction("");
      if (revisedNote) {
        setNoteShown(false); // restart the entrance for a fresh note
        setNote({ text: revisedNote, id: Date.now() });
      }
    } catch {
      // The error banner is owned by the parent; just leave the input as-is.
    }
  }

  // Hold the "here's what I did" note for a few seconds, then fade it out and clear it.
  useEffect(() => {
    if (!note) return;
    const show = requestAnimationFrame(() => setNoteShown(true)); // opacity 0 → 1 (entrance)
    const hide = setTimeout(() => setNoteShown(false), 3500); // begin fade after 3.5s
    const clear = setTimeout(() => setNote(null), 4200); // unmount after the fade
    return () => {
      cancelAnimationFrame(show);
      clearTimeout(hide);
      clearTimeout(clear);
    };
  }, [note]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function toggle(subtaskId: string, done: boolean) {
    setToggleError(null);
    setPendingId(subtaskId);
    try {
      await onToggleSubtask(subtaskId, done);
    } catch (e) {
      setToggleError(e instanceof Error ? e.message : "Couldn't update that step.");
    } finally {
      setPendingId(null);
    }
  }

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
            <ul className="mt-3 flex flex-col gap-1">
              {task.subtasks.map((s) => {
                const done = s.status === "done";
                const pending = pendingId === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => toggle(s.id, !done)}
                      aria-pressed={done}
                      aria-label={done ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}
                      className="flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-bg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    >
                      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded-full border transition-colors ${
                            done ? "border-accent bg-accent text-white" : "border-border"
                          }`}
                        >
                          <CheckIcon done={done} />
                        </span>
                        {done && (
                          <span
                            aria-hidden="true"
                            className="cadence-pulse pointer-events-none absolute inset-0 rounded-full bg-accent/30"
                          />
                        )}
                      </span>
                      <span className={`strike ${done ? "strike-done text-muted" : "text-text"}`}>
                        {s.title}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {toggleError && <p className="mt-2 text-sm text-overdue">{toggleError}</p>}
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

        {/* Email drafts */}
        {task.drafts.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted">Messages</h3>
            <div className="mt-3 flex flex-col gap-3">
              {task.drafts.map((d) => (
                <EmailDraftCard key={d.id} draft={d} />
              ))}
            </div>
          </section>
        )}

        {/* Adjust the plan in plain language — routes through the Layer 3 replan (§4) */}
        {incompleteCount > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
              Tell Cadence to adjust this
            </h3>
            <div className="mt-3 flex items-center gap-2">
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitReplan();
                  }
                }}
                placeholder="“Move this to tomorrow morning” · “I'm only free after 6pm”"
                aria-label="Describe a change to this task's plan"
                disabled={busy}
                className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
              />
              <MicButton state={voice.state} onStart={voice.start} onStop={voice.stop} />
              <button
                type="button"
                onClick={submitReplan}
                disabled={busy || !instruction.trim()}
                aria-busy={replanning}
                className="rounded-xl border border-border bg-surface px-4 py-2 text-sm transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {replanning ? "Thinking…" : "Revise"}
              </button>
            </div>
            {voice.error && <p className="mt-2 text-sm text-muted">{voice.error}</p>}
          </section>
        )}

        {note && (
          <p
            key={note.id}
            aria-live="polite"
            className={`voice mt-4 text-xl leading-snug text-text transition-opacity duration-700 ease-out ${
              noteShown ? "opacity-100" : "opacity-0"
            }`}
          >
            {note.text}
          </p>
        )}

        {rescheduleError && (
          <p className="mt-4 text-sm text-overdue">{rescheduleError}</p>
        )}

        {/* Actions */}
        <div className="mt-8 flex items-center gap-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-muted transition-colors hover:text-text disabled:opacity-40"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckIcon({ done }: { done: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline
        points="20 6 9 17 4 12"
        pathLength={1}
        className={`check-draw ${done ? "check-draw-done" : ""}`}
      />
    </svg>
  );
}
