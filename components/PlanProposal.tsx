"use client";

import type { PlanResult, ProposedBlock } from "@/lib/types";
import { formatDayHeading, formatTimeRange, formatEffort } from "@/lib/format";
import EmailDraftCard from "@/components/EmailDraftCard";

interface Props {
  plan: PlanResult;
  onConfirm: () => void;
  onDismiss: () => void;
  confirming: boolean;
}

function groupByDay(blocks: Array<ProposedBlock & { id: string }>) {
  const sorted = [...blocks].sort(
    (a, b) => new Date(a.start_iso).getTime() - new Date(b.start_iso).getTime(),
  );
  const groups: Array<{ day: string; blocks: Array<ProposedBlock & { id: string }> }> = [];
  for (const block of sorted) {
    const day = formatDayHeading(block.start_iso);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.blocks.push(block);
    else groups.push({ day, blocks: [block] });
  }
  return groups;
}

export default function PlanProposal({ plan, onConfirm, onDismiss, confirming }: Props) {
  const dayGroups = groupByDay(plan.blocks);

  return (
    <div className="flex flex-col gap-8">
      {/* The companion's voice */}
      <p className="font-serif text-2xl leading-snug tracking-tight">{plan.companionSummary}</p>

      {/* Subtasks */}
      {plan.subtasks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted">The work</h3>
          <ul className="flex flex-col gap-2">
            {plan.subtasks.map((s, i) => (
              <li key={i} className="flex items-baseline gap-3">
                <span className="w-5 shrink-0 text-sm text-muted">{i + 1}</span>
                <span className="flex-1">{s.title}</span>
                <span className="shrink-0 text-sm text-muted">{formatEffort(s.effort_minutes)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Proposed blocks */}
      {dayGroups.length > 0 && (
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
            When I&apos;d do it
          </h3>
          {dayGroups.map((group) => (
            <div key={group.day} className="flex flex-col gap-2">
              <p className="text-sm text-muted">{group.day}</p>
              <ul className="flex flex-col gap-2">
                {group.blocks.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-xl border border-border bg-surface px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">
                        {formatTimeRange(b.start_iso, b.end_iso)}
                      </span>
                      <span className="text-sm text-accent">{b.subtask ?? b.title}</span>
                    </div>
                    {b.reason && <p className="mt-1 text-sm text-muted">{b.reason}</p>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

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
          onClick={onConfirm}
          disabled={confirming || plan.blocks.length === 0}
          className="rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {confirming ? "Putting it on your calendar…" : "Confirm plan"}
        </button>
        <button
          onClick={onDismiss}
          disabled={confirming}
          className="text-muted transition-colors hover:text-text disabled:opacity-40"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
