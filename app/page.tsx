"use client";

import { useState, type CSSProperties } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

type AgentResult =
  | {
      ok: true;
      eventLink: string;
      eventId: string;
      args: Record<string, unknown>;
    }
  | { ok: false; error: string; text?: string; args?: Record<string, unknown> };

const TEST_PROMPT = "Block 2-3pm tomorrow for focus work on my DBMS assignment.";

export default function Home() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);

  async function createBlock() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: TEST_PROMPT,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      setResult((await res.json()) as AgentResult);
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={main}>
      <h1 style={{ marginBottom: 4 }}>Cadence — Day 1 proof</h1>
      <p style={{ color: "#6B6B64", marginTop: 0 }}>
        Sign in with Google, then ask the agent to block focus time. Gemini decides to call{" "}
        <code>create_calendar_block</code>, and a real event is created on your calendar.
      </p>

      {status === "loading" && <p>Loading…</p>}

      {status !== "authenticated" ? (
        <button onClick={() => signIn("google")} style={primaryBtn}>
          Sign in with Google
        </button>
      ) : (
        <>
          <p style={{ color: "#6B6B64" }}>
            Signed in as <strong>{session.user?.email}</strong>{" "}
            <button onClick={() => signOut()} style={linkBtn}>
              (sign out)
            </button>
          </p>
          <p style={{ fontStyle: "italic", color: "#6B6B64" }}>“{TEST_PROMPT}”</p>
          <button onClick={createBlock} disabled={loading} style={primaryBtn}>
            {loading ? "Working…" : "Create test block"}
          </button>
        </>
      )}

      {result && (
        <div style={{ marginTop: 24 }}>
          {result.ok ? (
            <p>
              ✅ Created.{" "}
              <a href={result.eventLink} target="_blank" rel="noreferrer">
                Open the event in Google Calendar →
              </a>
            </p>
          ) : (
            <p style={{ color: "#B07A5E" }}>⚠️ {result.error}</p>
          )}
          <pre style={pre}>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </main>
  );
}

const main: CSSProperties = {
  maxWidth: 600,
  margin: "10vh auto",
  padding: 24,
  lineHeight: 1.5,
};

const primaryBtn: CSSProperties = {
  padding: "10px 18px",
  fontSize: 16,
  cursor: "pointer",
  border: "1px solid #ECEAE3",
  borderRadius: 10,
  background: "#FFFFFF",
};

const linkBtn: CSSProperties = {
  border: "none",
  background: "none",
  color: "#7E8C6E",
  cursor: "pointer",
  fontSize: 14,
  padding: 0,
};

const pre: CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #ECEAE3",
  padding: 12,
  borderRadius: 10,
  overflow: "auto",
  fontSize: 12,
};
