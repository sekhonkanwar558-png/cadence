// Client-safe date formatting (renders in the browser's local timezone).

export function formatDayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function formatTimeRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const start = new Date(startIso).toLocaleTimeString(undefined, opts);
  const end = new Date(endIso).toLocaleTimeString(undefined, opts);
  return `${start} – ${end}`;
}

export function formatEffort(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** "in 6 hr", "in 2 days", "40 min ago" — calm relative deadline for task cards. */
export function formatRelativeDeadline(iso: string | null): string {
  if (!iso) return "no deadline";
  const diff = new Date(iso).getTime() - Date.now();
  const past = diff < 0;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);

  let span: string;
  if (mins < 60) span = `${mins} min`;
  else if (hours < 48) span = `${hours} hr`;
  else span = `${days} days`;

  return past ? `${span} ago` : `in ${span}`;
}
