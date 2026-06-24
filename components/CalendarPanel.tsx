"use client";

import { useEffect, useState } from "react";

/**
 * A slide-in panel showing the user's real Google Calendar via the public embed,
 * so Cadence-created events are visible without leaving the app. No new OAuth
 * scopes and no backend route — the embed is keyed by the session email. The
 * iframe is sandboxed and referrer-stripped for hygiene.
 */
export default function CalendarPanel({
  email,
  onClose,
}: {
  email: string;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setShown(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const src = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(email)}&mode=AGENDA`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-text/20" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Your calendar"
        onClick={(e) => e.stopPropagation()}
        className={`flex h-full w-full max-w-md flex-col border-l border-border bg-surface transition-transform duration-300 ease-out motion-reduce:transition-none ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-medium">Your calendar</h2>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close calendar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:border-accent/40 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            <CloseIcon />
          </button>
        </header>

        <iframe
          src={src}
          title="Your Google Calendar"
          className="min-h-0 flex-1 border-0"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />

        <p className="border-t border-border px-5 py-3 text-xs text-muted">
          Seeing nothing? Make sure you&apos;re signed into Google in this browser.
        </p>
      </aside>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
