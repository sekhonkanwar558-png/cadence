"use client";

import { useState } from "react";
import type { PlanResult, ProposedBlock, FinalizeItem } from "@/lib/types";
import { formatEffort, isoToDatetimeLocal, datetimeLocalAddMinutes } from "@/lib/format";
import EmailDraftCard from "@/components/EmailDraftCard";

interface Props {
  plan: PlanResult;
  onConfirm: (items: FinalizeItem[]) => void;
  /** Revise the plan from a plain-language instruction; resolves with revised items + a note. */
  onReplan: (
    instruction: string,
    current: FinalizeItem[],
  ) => Promise<{ items: FinalizeItem[]; note: string }>;
  onDismiss: () => void;
  confirming: boolean;
}

/** Editable row: one step, its scheduled time, and how long it takes. */
interface EditItem {
  key: string;
  title: string;
  durationMin: number;
  /** datetime-local value ("YYYY-MM-DDTHH:mm"), or "" when the step isn't scheduled. */
  start: string;
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

const INPUT =
  "rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

let keySeq = 0;
const nextKey = () => `item-${keySeq++}`;

/** Snap any minute count to the nearest offered duration so the select always matches. */
function snapToDuration(mins: number): number {
  return DURATIONS.reduce((best, d) => (Math.abs(d - mins) < Math.abs(best - mins) ? d : best), 30);
}

/** Snap a raw block length to the nearest offered duration so the select always matches. */
function snapDuration(b: ProposedBlock): number {
  const mins = Math.round((new Date(b.end_iso).getTime() - new Date(b.start_iso).getTime()) / 60000);
  return snapToDuration(mins);
}

/** Edited rows → the wall-clock FinalizeItem shape the server expects. */
function toFinalize(items: EditItem[]): FinalizeItem[] {
  return items
    .filter((it) => it.title.trim())
    .map((it) => ({
      title: it.title.trim(),
      effortMinutes: it.durationMin,
      start: it.start ? `${it.start}:00` : null,
      end: it.start ? `${datetimeLocalAddMinutes(it.start, it.durationMin)}:00` : null,
    }));
}

/** Server FinalizeItems (revised plan) → editable rows. */
function fromFinalize(items: FinalizeItem[]): EditItem[] {
  return items.map((it) => ({
    key: nextKey(),
    title: it.title,
    durationMin: snapToDuration(it.effortMinutes),
    start: it.start ? it.start.slice(0, 16) : "",
  }));
}

/** Pair each subtask with its proposed block (by label, else by order); keep extras. */
function buildItems(plan: PlanResult): EditItem[] {
  const blocks = [...plan.blocks];
  const used = new Set<number>();
  const items: EditItem[] = [];

  plan.subtasks.forEach((s, i) => {
    let bi = blocks.findIndex((b, idx) => !used.has(idx) && b.subtask === s.title);
    if (bi === -1 && blocks[i] && !used.has(i) && !blocks[i].subtask) bi = i;
    const b = bi >= 0 ? blocks[bi] : undefined;
    if (bi >= 0) used.add(bi);
    items.push({
      key: nextKey(),
      title: s.title,
      durationMin: b ? snapDuration(b) : s.effort_minutes || 30,
      start: b ? isoToDatetimeLocal(b.start_iso) : "",
    });
  });

  blocks.forEach((b, idx) => {
    if (used.has(idx)) return;
    items.push({
      key: nextKey(),
      title: b.subtask ?? b.title,
      durationMin: snapDuration(b),
      start: isoToDatetimeLocal(b.start_iso),
    });
  });

  return items;
}

export default function PlanProposal({ plan, onConfirm, onReplan, onDismiss, confirming }: Props) {
  const [items, setItems] = useState<EditItem[]>(() => buildItems(plan));
  const [instruction, setInstruction] = useState("");
  const [replanning, setReplanning] = useState(false);
  /** The companion's note from the latest revision; shown in place of the recommendation. */
  const [note, setNote] = useState<string | null>(null);

  function update(key: string, patch: Partial<EditItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function remove(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }
  function add() {
    // New step starts where the last scheduled one ends — an obvious, adjustable default.
    const lastScheduled = [...items].reverse().find((it) => it.start);
    const start = lastScheduled
      ? datetimeLocalAddMinutes(lastScheduled.start, lastScheduled.durationMin)
      : "";
    setItems((prev) => [...prev, { key: nextKey(), title: "", durationMin: 30, start }]);
  }

  function confirm() {
    onConfirm(toFinalize(items));
  }

  async function handleReplan() {
    const text = instruction.trim();
    if (!text || replanning || confirming) return;
    setReplanning(true);
    try {
      const revised = await onReplan(text, toFinalize(items));
      setItems(fromFinalize(revised.items));
      setNote(revised.note || null);
      setInstruction("");
    } catch {
      // The error banner is owned by the parent flow; just drop out of "thinking".
    } finally {
      setReplanning(false);
    }
  }

  const busy = confirming || replanning;
  const canConfirm = !busy && items.some((it) => it.title.trim());

  return (
    <div className="flex flex-col gap-8">
      {/* The companion's voice — the latest revision note takes over once the plan changes. */}
      <p className="font-serif text-2xl leading-snug tracking-tight">{plan.companionSummary}</p>
      {(note ?? plan.recommendation) && (
        <p key={note ?? "rec"} className="voice fade-in text-xl leading-snug text-text">
          {note ?? plan.recommendation}
        </p>
      )}

      {/* The editable plan — every control visible and adjustable */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
          The plan — edit anything before it&apos;s scheduled
        </h3>
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <li
              key={it.key}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center"
            >
              <input
                value={it.title}
                onChange={(e) => update(it.key, { title: e.target.value })}
                placeholder="What&apos;s this step?"
                aria-label="Step"
                className={`flex-1 ${INPUT}`}
              />
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={it.start}
                  onChange={(e) => update(it.key, { start: e.target.value })}
                  aria-label="Start time"
                  className={INPUT}
                />
                <select
                  value={it.durationMin}
                  onChange={(e) => update(it.key, { durationMin: Number(e.target.value) })}
                  aria-label="Duration"
                  className={INPUT}
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {formatEffort(d)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => remove(it.key)}
                  aria-label="Remove step"
                  className="rounded-lg px-2 py-2 text-muted transition-colors hover:text-overdue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={add}
          className="w-fit rounded-xl border border-border bg-surface px-4 py-2 text-sm transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          + Add a step
        </button>
      </section>

      {/* Revise in plain language — the companion reshapes the plan for you (§4) */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
          Or tell me what to change
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleReplan();
              }
            }}
            placeholder="“Do this tomorrow morning” · “I'm only free after 6pm”"
            aria-label="Describe a change to the plan"
            disabled={busy}
            className={`flex-1 ${INPUT} disabled:opacity-50`}
          />
          <button
            type="button"
            onClick={handleReplan}
            disabled={busy || !instruction.trim()}
            aria-busy={replanning}
            className="rounded-xl border border-border bg-surface px-4 py-2 text-sm transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {replanning ? "Thinking…" : "Revise"}
          </button>
        </div>
      </section>

      {/* Suggested email — review, edit, and send (or connect Gmail first) */}
      {plan.emailDraft && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
            A message I&apos;d send — your call
          </h3>
          <EmailDraftCard draft={plan.emailDraft} />
        </section>
      )}

      {/* Actions */}
      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={confirm}
          disabled={!canConfirm}
          className="rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {confirming ? "Putting it on your calendar…" : "Confirm plan"}
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          className="text-muted transition-colors hover:text-text disabled:opacity-40"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
