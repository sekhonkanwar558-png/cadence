/**
 * Timezone helpers for the editable-proposal finalize step. The client edits slot
 * times in a <input type="datetime-local">, which yields a timezone-NAIVE wall-clock
 * string (e.g. "2026-06-25T14:30:00"). To store/create those at the correct instant
 * we resolve them against the user's IANA time zone (sent from the client) rather than
 * letting the server read them as UTC.
 */

/** Offset (ms) between UTC and `timeZone` at the given instant — DST-aware. */
function offsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUtc - instant.getTime();
}

/**
 * Convert a naive wall-clock string interpreted in `timeZone` to a UTC instant ISO
 * (e.g. "2026-06-25T14:30:00" + "Asia/Kolkata" → "2026-06-25T09:00:00.000Z"). The
 * resulting ISO carries the correct offset, so it's right both in the DB (timestamptz)
 * and for the Google Calendar event. One refinement step handles DST boundaries.
 */
export function wallClockToInstantIso(wallClock: string, timeZone: string): string {
  const guess = new Date(`${wallClock}Z`); // treat the wall-clock as if it were UTC
  if (Number.isNaN(guess.getTime())) return new Date(wallClock).toISOString();

  const off = offsetMs(guess, timeZone);
  let instant = new Date(guess.getTime() - off);
  const off2 = offsetMs(instant, timeZone);
  if (off2 !== off) instant = new Date(guess.getTime() - off2);
  return instant.toISOString();
}

/**
 * Inverse of {@link wallClockToInstantIso}: render a UTC instant as the naive
 * wall-clock string ("YYYY-MM-DDTHH:mm:ss") an observer in `timeZone` would read
 * off the clock. Used by replan to write shifted slots back in the user's local zone.
 */
export function instantToWallClock(instant: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") m[p.type] = p.value;
  }
  return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}:${m.second}`;
}
