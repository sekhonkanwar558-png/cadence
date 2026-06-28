"use client";

import { useState } from "react";
import TaskComposer from "@/components/TaskComposer";
import ClarifyPrompt from "@/components/ClarifyPrompt";
import PlanProposal from "@/components/PlanProposal";
import { formatTimeRange } from "@/lib/format";
import type { ConfirmedBlock, FinalizeItem, PlanResult, TaskClarification } from "@/lib/types";

type Phase = "idle" | "thinking" | "clarifying" | "proposed" | "confirming" | "confirmed";

/** The Day-2 composer → proposal → confirm flow, now reached via "+ New task". */
export default function NewTaskFlow({
  onClose,
  onConfirmed,
  initialValue,
}: {
  onClose: () => void;
  /** Fires once the plan is successfully confirmed (used to acknowledge a source reminder). */
  onConfirmed?: () => void;
  initialValue?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Layer C: the pending vague task + the one question we asked about it.
  const [pendingTitle, setPendingTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [clarifyLoading, setClarifyLoading] = useState(false);

  /** POST to the planner; returns the parsed body or throws with a friendly message. */
  async function postPlan(payload: Record<string, unknown>) {
    const res = await fetch("/api/agent/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...payload,
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error ?? "Couldn't build a plan.");
    return data as
      | { ok: true; needsClarification: true; question: string }
      | { ok: true; plan: PlanResult };
  }

  async function submitTask(title: string) {
    setPhase("thinking");
    setError(null);
    try {
      const data = await postPlan({ title });
      // Layer C: a genuinely vague task — ask ONE question before planning.
      if ("needsClarification" in data) {
        setPendingTitle(title);
        setQuestion(data.question);
        setPhase("clarifying");
        return;
      }
      setPlan(data.plan);
      setPhase("proposed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("idle");
    }
  }

  /**
   * Plan the pending task after the clarify step — with the user's answer, or skipping it.
   * Either way the route plans directly (it never asks a second question).
   */
  async function planFromClarify(opts: { clarification?: TaskClarification; skipClarify?: boolean }) {
    if (!pendingTitle) return;
    setClarifyLoading(true);
    setError(null);
    try {
      const data = await postPlan({ title: pendingTitle, ...opts });
      if ("needsClarification" in data) return; // guarded server-side; defensive no-op
      setPlan(data.plan);
      setPhase("proposed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setClarifyLoading(false);
    }
  }

  /**
   * Revise the proposal from a plain-language instruction. Returns the revised items +
   * a companion note; throws on failure (PlanProposal resets its own "thinking" state,
   * the banner here shows the reason).
   */
  async function replanPlan(
    instruction: string,
    current: FinalizeItem[],
  ): Promise<{ items: FinalizeItem[]; note: string }> {
    if (!plan) throw new Error("No plan to revise.");
    setError(null);
    const res = await fetch("/api/agent/replan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskTitle: plan.task.title,
        deadline: plan.task.deadline,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        instruction,
        items: current,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error ?? "Couldn't revise the plan.");
      throw new Error(data.error ?? "replan failed");
    }
    return { items: data.items as FinalizeItem[], note: String(data.note ?? "") };
  }

  async function confirmPlan(items: FinalizeItem[]) {
    if (!plan) return;
    setPhase("confirming");
    setError(null);
    try {
      const res = await fetch("/api/agent/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: plan.taskId,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          items,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't confirm the plan.");
      setConfirmed(data.blocks as ConfirmedBlock[]);
      setPhase("confirmed");
      onConfirmed?.();
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
        <TaskComposer
          onSubmit={submitTask}
          loading={phase === "thinking"}
          initialValue={initialValue}
        />
      )}

      {phase === "clarifying" && (
        <ClarifyPrompt
          question={question}
          loading={clarifyLoading}
          onAnswer={(answer) => planFromClarify({ clarification: { question, answer } })}
          onSkip={() => planFromClarify({ skipClarify: true })}
        />
      )}

      {(phase === "proposed" || phase === "confirming") && plan && (
        <PlanProposal
          plan={plan}
          onConfirm={confirmPlan}
          onReplan={replanPlan}
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
