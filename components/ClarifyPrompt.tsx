"use client";

import { useState } from "react";

interface Props {
  /** The one perceptive question the companion is asking. */
  question: string;
  loading: boolean;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
}

/**
 * Layer C: the companion asks ONE clarifying question before planning a vague task.
 * The user answers (and we plan with that context) or skips ("Plan it anyway"). Either
 * path goes straight to planning — there is never a second question.
 */
export default function ClarifyPrompt({ question, loading, onAnswer, onSkip }: Props) {
  const [answer, setAnswer] = useState("");
  const canAnswer = !loading && answer.trim().length > 0;

  return (
    <div className="flex flex-col gap-5">
      <p className="voice text-2xl leading-snug text-text">{question}</p>

      <input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canAnswer) {
            e.preventDefault();
            onAnswer(answer.trim());
          }
        }}
        autoFocus
        disabled={loading}
        placeholder="A sentence is plenty…"
        aria-label="Your answer"
        className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-text placeholder:text-muted/70 outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => onAnswer(answer.trim())}
          disabled={!canAnswer}
          className="rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Thinking it through…" : "Answer & plan"}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={loading}
          className="text-muted transition-colors hover:text-text disabled:opacity-40"
        >
          Plan it anyway
        </button>
      </div>
    </div>
  );
}
