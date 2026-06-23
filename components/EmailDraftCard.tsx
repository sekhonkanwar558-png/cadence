"use client";

import { useState } from "react";
import { signIn, useSession } from "next-auth/react";

export interface DraftCardData {
  id: string;
  to: string | null;
  subject: string | null;
  body: string | null;
  status?: string; // "draft" | "sent"
}

const PROMPT = "Here's a draft I prepared — review and send when ready.";

export default function EmailDraftCard({ draft }: { draft: DraftCardData }) {
  const { data: session } = useSession();
  const hasGmail = Boolean(session?.hasGmail);

  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [to, setTo] = useState(draft.to ?? "");
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(draft.status === "sent");
  const [needsGmail, setNeedsGmail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, to, subject, body }),
      });
      const data = await res.json();
      if (data.needsReauth) {
        setNeedsGmail(true);
        return;
      }
      if (!data.ok) throw new Error(data.error ?? "Couldn't send the email.");
      setSent(true);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the email.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-sm text-on-track">Sent ✓</p>
        <p className="mt-1 text-sm text-muted">
          To <span className="text-text">{to}</span> — {subject}
        </p>
      </div>
    );
  }

  const bodyIsLong = body.length > 220;
  const shownBody = expanded || !bodyIsLong ? body : `${body.slice(0, 220).trimEnd()}…`;
  const connectNeeded = !hasGmail || needsGmail;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-4">
      <p className="voice text-base text-text">{PROMPT}</p>

      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Recipient"
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Message"
            className="resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </div>
      ) : (
        <div>
          <p className="text-sm text-muted">
            To <span className="text-text">{to || "—"}</span>
          </p>
          <p className="mt-1 font-medium">{subject || "(no subject)"}</p>
          <p className="mt-2 whitespace-pre-line text-sm text-text/90">{shownBody}</p>
          {bodyIsLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-sm text-accent hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-overdue">{error}</p>}

      <div className="flex items-center gap-4 pt-1">
        {connectNeeded ? (
          <button
            onClick={() => signIn("google")}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Connect Gmail to send
          </button>
        ) : (
          <button
            onClick={send}
            disabled={sending}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        )}
        <button
          onClick={() => setEditing((v) => !v)}
          disabled={sending}
          className="text-sm text-muted transition-colors hover:text-text disabled:opacity-40"
        >
          {editing ? "Done editing" : "Edit"}
        </button>
      </div>
    </div>
  );
}
