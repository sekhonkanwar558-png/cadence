import { getUserHistory } from "@/lib/supabase/queries";

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
