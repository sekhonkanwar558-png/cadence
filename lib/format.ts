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

const pad2 = (n: number) => String(n).padStart(2, "0");

/** ISO instant → a `<input type="datetime-local">` value in the browser's local zone. */
export function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Add minutes to a datetime-local value, returning another datetime-local value (local zone). */
export function datetimeLocalAddMinutes(value: string, minutes: number): string {
  const d = new Date(value); // a value without offset parses as local time
  if (Number.isNaN(d.getTime())) return value;
  const end = new Date(d.getTime() + minutes * 60000);
  return `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}T${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
}

/**
 * "Today at 2:00 PM", "Tomorrow at 9:00 AM", "Friday, 29 Jun at 3:00 PM" — a clear,
 * human-readable deadline for the reminder confirm step. Renders in the browser's local
 * zone; composes the day/month part explicitly so it reads "29 Jun" (day before month).
 */
export function formatDeadlineHuman(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const dayDiff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86400000);
  if (dayDiff === 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Tomorrow at ${time}`;

  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  const month = d.toLocaleDateString(undefined, { month: "short" });
  return `${weekday}, ${d.getDate()} ${month} at ${time}`;
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
