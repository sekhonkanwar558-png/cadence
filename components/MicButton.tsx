"use client";

import type { VoiceState } from "@/components/useVoiceInput";

/** Three-state mic button (idle / recording / transcribing) shared by the composers. */
export default function MicButton({
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
