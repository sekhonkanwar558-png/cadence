"use client";

import { useCallback, useEffect, useState } from "react";
import ReminderComposer from "@/components/ReminderComposer";
import ReminderCard from "@/components/ReminderCard";
import { reminderUrgency, type ReminderUrgency } from "@/lib/reminders/urgency";
import { urgencyRank } from "@/lib/urgency";
import { formatRelativeDeadline } from "@/lib/format";
import type { Reminder } from "@/lib/types";

interface Props {
  /** Promote a reminder into the full task planner (the "Plan it" bridge). */
  onPlan: (reminder: Reminder) => void;
}

interface Ranked {
  r: Reminder;
  u: ReminderUrgency;
}

/** The Reminders tab + triage: the companion's verdict, the add form, and a ranked list. */
export default function RemindersView({ onPlan }: Props) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reminders");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't load your reminders.");
      setReminders(data.reminders as Reminder[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your reminders.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(path: string, id: string, body?: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Something went wrong.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  const acknowledge = (id: string) => act(`/api/reminders/${id}/acknowledge`, id);
  const snooze = (id: string, snoozedUntil: string) =>
    act(`/api/reminders/${id}/snooze`, id, { snoozedUntil });

  // Triage: rank by urgency tier, then soonest deadline. The single pressing top
  // (action-needed or critical) becomes the hero; quiet (snoozed) reminders sink + fade.
  const now = Date.now();
  const ranked: Ranked[] = reminders
    .map((r) => ({
      r,
      u: reminderUrgency({
        stakes: r.stakes,
        deadline: r.deadline,
        now,
        status: r.status,
        snoozedUntil: r.snoozed_until,
      }),
    }))
    .sort((a, b) => {
      const byTier = urgencyRank(b.u.tier) - urgencyRank(a.u.tier);
      if (byTier !== 0) return byTier;
      return new Date(a.r.deadline).getTime() - new Date(b.r.deadline).getTime();
    });

  const pressingCount = ranked.filter((x) => urgencyRank(x.u.tier) >= 2).length;
  const hero = ranked[0] && urgencyRank(ranked[0].u.tier) >= 2 ? ranked[0] : null;
  const rest = hero ? ranked.slice(1) : ranked;

  return (
    <section className="flex flex-col gap-6">
      <p className="voice text-2xl leading-snug">{summaryLine(ranked.length, hero, pressingCount)}</p>

      <ReminderComposer onCreated={load} />

      {error && (
        <div className="rounded-xl border border-overdue/40 bg-overdue/5 px-4 py-3 text-sm text-overdue">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading your reminders…</p>
      ) : ranked.length === 0 ? (
        <p className="text-muted">No reminders yet. Add one above and I&apos;ll keep watch.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {hero && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">Needs you now</span>
              <ReminderCard
                reminder={hero.r}
                onAcknowledge={acknowledge}
                onSnooze={snooze}
                onPlan={onPlan}
                busy={busyId === hero.r.id}
                hero
              />
            </div>
          )}

          {rest.length > 0 && (
            <ul className="flex flex-col gap-3">
              {rest.map(({ r, u }) => {
                const quiet = r.status === "snoozed" && u.tier === "none";
                return (
                  <li key={r.id} className={quiet ? "opacity-60" : undefined}>
                    <ReminderCard
                      reminder={r}
                      onAcknowledge={acknowledge}
                      onSnooze={snooze}
                      onPlan={onPlan}
                      busy={busyId === r.id}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** The companion's verdict line, naming the one that needs the user most. */
function summaryLine(total: number, hero: Ranked | null, pressingCount: number): string {
  if (total === 0) return "Nothing to remember yet.";
  if (!hero) return "Nothing pressing — you're ahead of it.";
  const lead =
    hero.u.hoursLeft !== null && hero.u.hoursLeft <= 0
      ? `${hero.r.title} is overdue.`
      : `${hero.r.title} needs you ${formatRelativeDeadline(hero.r.deadline)}.`;
  return pressingCount > 1 ? `${lead} ${pressingCount - 1} more close behind.` : lead;
}
