"use client";

import { useState } from "react";
import TaskComposer from "@/components/TaskComposer";
import PlanProposal from "@/components/PlanProposal";
import { formatTimeRange } from "@/lib/format";
import type { ConfirmedBlock, PlanResult } from "@/lib/types";

type Phase = "idle" | "thinking" | "proposed" | "confirming" | "confirmed";

/** The Day-2 composer → proposal → confirm flow, now reached via "+ New task". */
export default function NewTaskFlow({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitTask(title: string) {
    setPhase("thinking");
    setError(null);
    try {
      const res = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't build a plan.");
      setPlan(data.plan as PlanResult);
      setPhase("proposed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("idle");
    }
  }

  async function confirmPlan() {
    if (!plan) return;
    setPhase("confirming");
    setError(null);
    try {
      const res = await fetch("/api/agent/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: plan.taskId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't confirm the plan.");
      setConfirmed(data.blocks as ConfirmedBlock[]);
      setPhase("confirmed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach your calendar.");
      setPhase("proposed");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <button onClick={onClose} className="w-fit text-sm text-muted transition-colors hover:text-text">
        ← Back to dashboard
      </button>

      {error && (
        <div className="rounded-xl border border-overdue/40 bg-overdue/5 px-4 py-3 text-sm text-overdue">
          {error}
        </div>
      )}

      {(phase === "idle" || phase === "thinking") && (
        <TaskComposer onSubmit={submitTask} loading={phase === "thinking"} />
      )}

      {(phase === "proposed" || phase === "confirming") && plan && (
        <PlanProposal
          plan={plan}
          onConfirm={confirmPlan}
          onDismiss={onClose}
          confirming={phase === "confirming"}
        />
      )}

      {phase === "confirmed" && confirmed && (
        <div className="flex flex-col gap-6">
          <p className="voice text-2xl leading-snug">
            Done — it&apos;s on your calendar. I&apos;ll keep watch.
          </p>
          <ul className="flex flex-col gap-2">
            {confirmed.map((b) => (
              <li
                key={b.id}
                className="flex items-baseline justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <span className="font-medium">{b.title}</span>
                <a
                  href={b.eventLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-accent hover:underline"
                >
                  {formatTimeRange(b.start, b.end)} ↗
                </a>
              </li>
            ))}
          </ul>
          <button onClick={onClose} className="w-fit text-accent hover:underline">
            Back to dashboard
          </button>
        </div>
      )}
    </div>
  );
}
