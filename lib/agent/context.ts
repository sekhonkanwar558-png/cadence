import { getUserHistory, getPlanningSnapshot } from "@/lib/supabase/queries";

/** Buckets a 24h clock into a human phrase. */
function hourBucket(hour: number): string {
  if (hour < 5) return "late at night";
  if (hour < 12) return "in the mornings";
  if (hour < 17) return "in the afternoons";
  if (hour < 21) return "in the evenings";
  return "late at night";
}

function localHour(iso: string, timezone: string): number {
  const h = new Date(iso).toLocaleString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  return Number(h) % 24;
}

const REVIEW_WORDS = ["review", "proofread", "notes", "revise", "check", "edit"];

/**
 * A short (<200 token) summary of the user's recent history, fed into the
 * decomposition recommendation prompt so insights feel earned, not generic (§4).
 * Degrades gracefully when there's little history.
 */
export async function buildUserContext(userId: string, timezone: string): Promise<string> {
  const history = await getUserHistory(userId);
  if (history.tasks.length < 3) return "New here — limited history so far.";

  // Most common task type.
  const typeCounts = new Map<string, number>();
  for (const t of history.tasks) {
    if (t.type) typeCounts.set(t.type, (typeCounts.get(t.type) ?? 0) + 1);
  }
  const topType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Dominant active hour bucket.
  const bucketCounts = new Map<string, number>();
  for (const t of history.tasks) {
    const b = hourBucket(localHour(t.created_at, timezone));
    bucketCounts.set(b, (bucketCounts.get(b) ?? 0) + 1);
  }
  const topBucket = [...bucketCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Frequently-skipped subtask kinds.
  const leavesReview = history.incompleteSubtaskTitles.some((title) =>
    REVIEW_WORDS.some((w) => title.toLowerCase().includes(w)),
  );

  const parts: string[] = [];
  if (topType) parts.push(`usually has ${topType} tasks`);
  if (topBucket) parts.push(`tends to work ${topBucket}`);
  if (leavesReview) parts.push("often leaves 'review' steps for last");

  return parts.length ? `This user ${parts.join("; ")}.` : "Limited history so far.";
}

/** Short weekday label for a deadline in the user's zone, e.g. "Thu" (or "no deadline"). */
function dayLabel(iso: string | null, timezone: string): string {
  if (!iso) return "no deadline";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: timezone, weekday: "short" });
}

/** ISO-style YYYY-MM-DD in the user's zone, for bucketing blocks into local days. */
function localDateKey(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: timezone });
}

/**
 * Layer B planning context: the user's OTHER active commitments and how loaded the
 * next 7 days already are, so the planner can avoid stacking work on busy days and
 * the companion can cite real constraints. Compact (<~150 tokens), degrades gracefully.
 */
export async function buildScheduleContext(
  userId: string,
  nowIso: string,
  timezone: string,
): Promise<string> {
  const { activeTasks, upcomingBlocks } = await getPlanningSnapshot(userId, nowIso, 7);

  // Other active commitments (cap the list so the prompt stays compact).
  let commitments: string;
  if (activeTasks.length === 0) {
    commitments = "Nothing else active right now.";
  } else {
    const items = activeTasks
      .slice(0, 8)
      .map((t) => {
        const urg = t.urgency && t.urgency !== "none" ? `, ${t.urgency}` : "";
        return `${t.title} (due ${dayLabel(t.deadline, timezone)}${urg})`;
      })
      .join("; ");
    commitments = `Also on your plate: ${items}.`;
  }

  // Confirmed-block load, bucketed by local day.
  let load: string;
  if (upcomingBlocks.length === 0) {
    load = "No work blocks scheduled in the next 7 days.";
  } else {
    const counts = new Map<string, number>();
    for (const b of upcomingBlocks) {
      const key = localDateKey(b.start, timezone);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const todayKey = localDateKey(nowIso, timezone);
    const tomorrowKey = localDateKey(
      new Date(new Date(nowIso).getTime() + 24 * 3600000).toISOString(),
      timezone,
    );
    const parts = [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, n]) => {
        let label: string;
        if (key === todayKey) label = "Today";
        else if (key === tomorrowKey) label = "Tomorrow";
        else
          label = new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
            weekday: "short",
            timeZone: "UTC",
          });
        return `${label}: ${n}`;
      });
    load = `Scheduled load next 7 days — ${parts.join(", ")}.`;
  }

  return `${commitments} ${load}`;
}
