"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";

interface Props {
  email: string;
  name?: string | null;
}

/** Compact account control: an initials avatar that opens a minimal email + sign-out menu. */
export default function ProfileMenu({ email, name }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on any click outside the menu (no library — a single document listener).
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const initial = (name?.trim()?.[0] ?? email?.trim()?.[0] ?? "").toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-sm font-medium text-accent transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
      >
        {initial || <PersonIcon />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-border bg-surface p-3 shadow-sm"
        >
          {email && <p className="break-all text-xs text-muted">{email}</p>}
          <button
            type="button"
            onClick={() => signOut()}
            className="mt-3 text-sm text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function PersonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}
