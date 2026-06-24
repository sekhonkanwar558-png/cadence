"use client";

import { useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { useVoiceInput, type VoiceState } from "@/components/useVoiceInput";

interface Props {
  onSubmit: (title: string) => void;
  loading: boolean;
  initialValue?: string;
}

export default function TaskComposer({ onSubmit, loading, initialValue }: Props) {
  const { status } = useSession();
  const [value, setValue] = useState(initialValue ?? "");
  const voice = useVoiceInput((text) =>
    setValue((v) => (v.trim() ? `${v.trim()} ${text}` : text)),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (v && !loading) onSubmit(v);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-3xl tracking-tight">What&apos;s on your plate?</h2>
        <p className="mt-2 text-muted">
          Tell me in plain words{status === "authenticated" ? " — type or speak" : ""}. I&apos;ll
          break it down and find time for it on your calendar.
        </p>
      </div>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
        }}
        rows={2}
        placeholder="Tell me what needs doing…"
        className="w-full resize-none rounded-xl border border-border bg-surface px-4 py-3 text-text placeholder:text-muted/70 outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
      />

      {voice.error && <p className="text-sm text-muted">{voice.error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Thinking it through…" : "Plan it"}
        </button>

        {/* Mic only renders when signed in */}
        {status === "authenticated" && (
          <MicButton state={voice.state} onStart={voice.start} onStop={voice.stop} />
        )}

        <span className="text-sm text-muted">⌘/Ctrl + Enter</span>
      </div>
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
    "flex h-10 w-10 items-center justify-center rounded-xl border bg-surface transition-colors";

  if (state === "transcribing") {
    return (
      <span className={`${base} border-border`} aria-label="Transcribing">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
      </span>
    );
  }

  if (state === "recording") {
    return (
      <button
        type="button"
        onClick={onStop}
        aria-label="Stop recording"
        className={`${base} border-[#C2554D]/50`}
      >
        {/* The one place a non-calm color is allowed — a live recording indicator. */}
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
      <MicIcon />
    </button>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="21" />
    </svg>
  );
}
