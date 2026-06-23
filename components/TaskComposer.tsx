"use client";

import { useState, type FormEvent } from "react";

interface Props {
  onSubmit: (title: string) => void;
  loading: boolean;
}

export default function TaskComposer({ onSubmit, loading }: Props) {
  const [value, setValue] = useState("");

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
          Tell me in plain words. I&apos;ll break it down and find time for it on your calendar.
        </p>
      </div>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
        }}
        rows={2}
        placeholder="Finish DBMS assignment by Friday 5pm"
        className="w-full resize-none rounded-xl border border-border bg-surface px-4 py-3 text-text placeholder:text-muted/70 outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
      />

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Thinking it through…" : "Plan it"}
        </button>
        <span className="text-sm text-muted">⌘/Ctrl + Enter</span>
      </div>
    </form>
  );
}
