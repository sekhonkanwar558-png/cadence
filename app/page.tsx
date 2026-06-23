"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import CompanionBanner from "@/components/CompanionBanner";
import TaskCard from "@/components/TaskCard";
import TaskDetail from "@/components/TaskDetail";
import NewTaskFlow from "@/components/NewTaskFlow";
import type { DashboardTask } from "@/lib/types";

type Mode = "dashboard" | "new-task";

const CALM = "You're on track. Nothing needs you right now.";

export default function Home() {
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<Mode>("dashboard");
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [companion, setCompanion] = useState(CALM);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [checking, setChecking] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyPayload = (data: { tasks: DashboardTask[]; companionMessage: string }) => {
    setTasks(data.tasks);
    setCompanion(data.companionMessage);
  };

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't load your tasks.");
      applyPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") fetchTasks();
  }, [status, fetchTasks]);

  async function loadDemo() {
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/seed", { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't load the demo.");
      applyPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the demo.");
    } finally {
      setSeeding(false);
    }
  }

  async function checkDeadlines() {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/escalate/run", { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't check your deadlines.");
      applyPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check your deadlines.");
    } finally {
      setChecking(false);
    }
  }

  async function reschedule() {
    if (!selectedId) return;
    setRescheduling(true);
    setRescheduleError(null);
    try {
      const res = await fetch(`/api/tasks/${selectedId}/reschedule`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't reschedule.");
      const tRes = await fetch("/api/tasks");
      const tData = await tRes.json();
      if (tData.ok) applyPayload(tData);
    } catch (e) {
      setRescheduleError(e instanceof Error ? e.message : "Couldn't reschedule.");
    } finally {
      setRescheduling(false);
    }
  }

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
      <header className="mb-12 flex items-center justify-between">
        <span className="voice text-lg">Cadence</span>
        {status === "authenticated" && (
          <span className="text-sm text-muted">
            {session.user?.email}{" "}
            <button onClick={() => signOut()} className="text-accent hover:underline">
              Sign out
            </button>
          </span>
        )}
      </header>

      {status === "loading" && <p className="text-muted">Loading…</p>}

      {status !== "authenticated" && status !== "loading" && (
        <section className="flex flex-1 flex-col justify-center gap-6">
          <div>
            <h1 className="voice text-4xl leading-tight">The important things, handled.</h1>
            <p className="mt-3 max-w-md text-muted">
              Cadence breaks down what you commit to, finds time for it, and quietly keeps watch as
              deadlines approach — so you only deal with what genuinely needs you.
            </p>
          </div>
          <button
            onClick={() => signIn("google")}
            className="w-fit rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition-opacity hover:opacity-90"
          >
            Continue with Google
          </button>
        </section>
      )}

      {status === "authenticated" && mode === "new-task" && (
        <NewTaskFlow
          onClose={() => {
            setMode("dashboard");
            fetchTasks();
          }}
        />
      )}

      {status === "authenticated" && mode === "dashboard" && (
        <section className="flex flex-col gap-8">
          <CompanionBanner message={companion} />

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={checkDeadlines}
              disabled={checking}
              className="rounded-xl bg-accent px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {checking ? "Checking…" : "Check my deadlines"}
            </button>
            <button
              onClick={loadDemo}
              disabled={seeding}
              className="rounded-xl border border-border bg-surface px-4 py-2 transition-colors hover:border-accent/40 disabled:opacity-40"
            >
              {seeding ? "Loading…" : "Load demo"}
            </button>
            <button
              onClick={() => setMode("new-task")}
              className="rounded-xl border border-border bg-surface px-4 py-2 transition-colors hover:border-accent/40"
            >
              + New task
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-overdue/40 bg-overdue/5 px-4 py-3 text-sm text-overdue">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-muted">Loading your tasks…</p>
          ) : tasks.length === 0 ? (
            <p className="text-muted">
              Nothing here yet. Add a task, or load the demo to watch Cadence prioritize.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {tasks.map((task) => (
                <li key={task.id}>
                  <TaskCard task={task} onOpen={(t) => setSelectedId(t.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {selected && (
        <TaskDetail
          task={selected}
          onClose={() => {
            setSelectedId(null);
            setRescheduleError(null);
          }}
          onReschedule={reschedule}
          rescheduling={rescheduling}
          rescheduleError={rescheduleError}
        />
      )}
    </main>
  );
}
