// Cadence — autonomous escalation monitor (Supabase Edge Function, Deno).
// Runs every 12h via pg_cron, and on-demand from the dashboard via /api/escalate/run.
// Pure deadline math — NO Gemini.
//
// Day 7: the monitor ACTS — sends real Gmail nudges via the user's stored
// google_refresh_token. Reminders push: it now ALSO chases standalone reminders
// (pure deadlines) using the SAME shared urgency math the frontend uses, escalating
// by stakes + proximity, one email per newly-crossed tier, idempotent via
// reminder_escalations(reminder_id, tier).
//
// Auth: verify_jwt is on; we additionally require the caller to be service-role.
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (in addition to injected SUPABASE_*).
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";

type Kind = "heads-up" | "action-needed" | "critical";

// Reminder urgency math — INLINED here (kept in sync with lib/reminders/urgency.ts, the
// canonical source) so this Edge Function deploys as a single self-contained file with no
// cross-directory imports. Stakes ramp: critical 3d / medium 2d / low 1d; overdue = loudest.
type ReminderTier = "none" | "heads-up" | "action-needed" | "critical";

const REMINDER_THRESHOLDS: Record<
  "low" | "medium" | "critical",
  { headsUp: number; actionNeeded: number; critical: number }
> = {
  critical: { headsUp: 72, actionNeeded: 24, critical: 6 },
  medium: { headsUp: 48, actionNeeded: 12, critical: 3 },
  low: { headsUp: 24, actionNeeded: 6, critical: 1 },
};

function reminderUrgency(input: {
  stakes: "low" | "medium" | "critical";
  deadline: string | null;
  now: number;
  status: "active" | "acknowledged" | "snoozed" | "done";
  snoozedUntil?: string | null;
}): { tier: ReminderTier; shouldChase: boolean; hoursLeft: number | null } {
  const { stakes, deadline, now, status, snoozedUntil } = input;
  const hrs = deadline ? (new Date(deadline).getTime() - now) / 3600000 : null;
  if (status === "acknowledged" || status === "done") return { tier: "none", shouldChase: false, hoursLeft: hrs };
  if (status === "snoozed" && snoozedUntil) {
    const until = new Date(snoozedUntil).getTime();
    if (!Number.isNaN(until) && now < until) return { tier: "none", shouldChase: false, hoursLeft: hrs };
  }
  if (hrs === null || Number.isNaN(hrs)) return { tier: "none", shouldChase: false, hoursLeft: null };
  if (hrs <= 0) return { tier: "critical", shouldChase: true, hoursLeft: hrs };
  const t = REMINDER_THRESHOLDS[stakes];
  let tier: ReminderTier = "none";
  if (hrs <= t.headsUp) tier = "heads-up";
  if (hrs <= t.actionNeeded) tier = "action-needed";
  if (hrs <= t.critical) tier = "critical";
  return { tier, shouldChase: tier !== "none", hoursLeft: hrs };
}

interface TaskRow {
  id: string;
  title: string;
  deadline: string;
  user_id: string;
}
interface SubRow {
  task_id: string;
  status: string;
  effort_minutes: number | null;
}
interface EscRow {
  task_id: string;
  kind: string;
}
interface ReminderRow {
  id: string;
  title: string;
  stakes: "low" | "medium" | "critical";
  deadline: string | null;
  status: "active" | "acknowledged" | "snoozed" | "done";
  snoozed_until: string | null;
  user_id: string;
}
interface ReminderEscRow {
  reminder_id: string;
  tier: string;
}
interface EmailIntent {
  userId: string;
  title: string;
  kind: Kind;
  hoursLeft: number;
  incompleteCount: number;
}
interface ReminderEmailIntent {
  userId: string;
  title: string;
  tier: ReminderTier;
  hoursLeft: number;
  stakes: "low" | "medium" | "critical";
}
/** A ready-to-send message (task or reminder), already rendered to subject + body. */
interface Outbox {
  userId: string;
  subject: string;
  body: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Decode the JWT payload role claim (no signature check — the gateway already verified it). */
function bearerRole(authHeader: string): string | null {
  const m = authHeader.match(/^Bearer\s+(.+)$/);
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json).role as string) ?? null;
  } catch {
    return null;
  }
}

/** Mint a fresh access token from a stored refresh token via the OAuth2 refresh flow. */
async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    console.error(`escalate: token refresh failed (${res.status})`, (await res.text()).slice(0, 200));
    return null;
  }
  const data = await res.json();
  return (data.access_token as string) ?? null;
}

/** base64url-encode a string (Deno has no Buffer — encode UTF-8 bytes then btoa). */
function base64url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Send a plain-text email via the Gmail REST API. Returns whether it succeeded. */
async function sendGmail(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  const mime = [
    `To: ${to}`,
    `Subject: ${subject.replace(/[\r\n]+/g, " ")}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "MIME-Version: 1.0",
    "",
    body,
  ].join("\r\n");

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64url(mime) }),
    },
  );
  if (!res.ok) {
    console.error(`escalate: gmail send failed (${res.status})`, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/** Templated companion-voice TASK nudge, varied by tier. */
function emailFor(intent: EmailIntent): { subject: string; body: string } {
  const { title, kind, hoursLeft, incompleteCount } = intent;
  const hrs = Math.max(0, hoursLeft);
  const when =
    hrs <= 1 ? "in the next hour" : hrs < 24 ? `in about ${hrs} hours` : `in about ${Math.round(hrs / 24)} days`;
  const steps =
    incompleteCount > 0
      ? `${incompleteCount} step${incompleteCount === 1 ? "" : "s"} still open`
      : "nothing left but the finish line";
  const sign = "\n\n— Cadence";

  if (kind === "critical") {
    return {
      subject: `"${title}" is due very soon`,
      body:
        `This one's due ${when}, with ${steps}. If you can give it even a focused ` +
        `20 minutes now, you'll be in much better shape. I'm keeping watch.${sign}`,
    };
  }
  if (kind === "action-needed") {
    return {
      subject: `"${title}" needs you today`,
      body:
        `Just a gentle flag: "${title}" is due ${when}, and there ${
          incompleteCount === 1 ? "is" : "are"
        } ${steps}. A good moment to make a start while there's still room.${sign}`,
    };
  }
  return {
    subject: `A heads-up on "${title}"`,
    body:
      `No rush yet — "${title}" is due ${when}, with ${steps}. Nudging you early so it ` +
      `never becomes a scramble. You've got time if you start soon.${sign}`,
  };
}

/** Templated companion-voice REMINDER nudge, varied by tier (stakes-aware). */
function reminderEmailFor(intent: ReminderEmailIntent): { subject: string; body: string } {
  const { title, tier, hoursLeft, stakes } = intent;
  const overdue = hoursLeft <= 0;
  const hrs = Math.max(0, hoursLeft);
  const when = overdue
    ? "now overdue"
    : hrs <= 1
      ? "due within the hour"
      : hrs < 24
        ? `due in about ${hrs} hours`
        : `due in about ${Math.round(hrs / 24)} days`;
  const weight = stakes === "critical" ? " You marked this one critical." : "";
  const sign = "\n\n— Cadence";

  if (tier === "critical") {
    return {
      subject: overdue ? `"${title}" is overdue` : `"${title}" is due very soon`,
      body:
        `This is the moment for "${title}" — it's ${when}.${weight} The fastest way to clear it: ` +
        `do it right now if you can, or open Cadence and snooze it to a time you truly will. ` +
        `I'm on it with you.${sign}`,
    };
  }
  if (tier === "action-needed") {
    return {
      subject: `"${title}" needs you today`,
      body:
        `A nudge: "${title}" is ${when}.${weight} Worth handling today while it's still easy — ` +
        `clear it, or tell me when to chase you again.${sign}`,
    };
  }
  return {
    subject: `A heads-up on "${title}"`,
    body:
      `No rush yet — "${title}" is ${when}.${weight} Flagging it early so it never turns into a ` +
      `last-minute scramble.${sign}`,
  };
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  const auth = req.headers.get("Authorization") ?? "";

  const authorized = auth === `Bearer ${serviceKey}` || bearerRole(auth) === "service_role";
  if (!authorized) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const db = createClient(supabaseUrl, serviceKey);
  const now = Date.now();

  const outbox: Outbox[] = [];

  // ---- Tasks ----
  const { data: taskData, error: taskErr } = await db
    .from("tasks")
    .select("id, title, deadline, user_id")
    .eq("status", "active")
    .not("deadline", "is", null);
  if (taskErr) return json({ ok: false, error: taskErr.message }, 500);

  const tasks = (taskData ?? []) as TaskRow[];
  const ids = tasks.map((t) => t.id);
  const fired: Array<{ taskId: string; title: string; kind: Kind; hoursLeft: number }> = [];

  if (ids.length > 0) {
    const [{ data: subData }, { data: escData }] = await Promise.all([
      db.from("subtasks").select("task_id, status, effort_minutes").in("task_id", ids),
      db.from("escalations").select("task_id, kind").in("task_id", ids),
    ]);

    const subsByTask = new Map<string, SubRow[]>();
    for (const s of (subData ?? []) as SubRow[]) {
      const list = subsByTask.get(s.task_id) ?? [];
      list.push(s);
      subsByTask.set(s.task_id, list);
    }

    const firedByTask = new Map<string, Set<string>>();
    for (const e of (escData ?? []) as EscRow[]) {
      const set = firedByTask.get(e.task_id) ?? new Set<string>();
      set.add(e.kind);
      firedByTask.set(e.task_id, set);
    }

    const newEscalations: Array<{ task_id: string; kind: Kind }> = [];
    const emailIntents: EmailIntent[] = [];

    for (const t of tasks) {
      const hoursLeft = (new Date(t.deadline).getTime() - now) / 3600000;
      const subs = subsByTask.get(t.id) ?? [];
      const incompleteCount = subs.filter((s) => s.status !== "done").length;
      const allDone = subs.length > 0 && incompleteCount === 0;

      const crossed: Kind[] = [];
      if (hoursLeft <= 48) crossed.push("heads-up");
      if (hoursLeft <= 24) crossed.push("action-needed");
      if (hoursLeft <= 6) crossed.push("critical");

      if (crossed.length === 0 || allDone) {
        if (allDone) await db.from("tasks").update({ urgency: "none" }).eq("id", t.id);
        continue;
      }

      const topKind = crossed[crossed.length - 1];
      const already = firedByTask.get(t.id) ?? new Set<string>();
      const newKinds = crossed.filter((k) => !already.has(k));
      for (const k of newKinds) newEscalations.push({ task_id: t.id, kind: k });

      await db.from("tasks").update({ urgency: topKind }).eq("id", t.id);

      if (newKinds.length > 0) {
        emailIntents.push({
          userId: t.user_id,
          title: t.title,
          kind: newKinds[newKinds.length - 1],
          hoursLeft: Math.round(hoursLeft),
          incompleteCount,
        });
      }
      fired.push({ taskId: t.id, title: t.title, kind: topKind, hoursLeft: Math.round(hoursLeft) });
    }

    if (newEscalations.length > 0) {
      await db
        .from("escalations")
        .upsert(newEscalations, { onConflict: "task_id,kind", ignoreDuplicates: true });
    }
    for (const intent of emailIntents) outbox.push({ userId: intent.userId, ...emailFor(intent) });
  }

  // ---- Reminders (pure deadlines, stakes-driven, shared urgency math) ----
  const { data: remData, error: remErr } = await db
    .from("reminders")
    .select("id, title, stakes, deadline, status, snoozed_until, user_id")
    .in("status", ["active", "snoozed"]);
  if (remErr) return json({ ok: false, error: remErr.message }, 500);

  const reminders = (remData ?? []) as ReminderRow[];
  const remIds = reminders.map((r) => r.id);
  const remindersFired: Array<{ reminderId: string; title: string; tier: ReminderTier }> = [];

  if (remIds.length > 0) {
    const { data: remEscData } = await db
      .from("reminder_escalations")
      .select("reminder_id, tier")
      .in("reminder_id", remIds);

    const firedByReminder = new Map<string, Set<string>>();
    for (const e of (remEscData ?? []) as ReminderEscRow[]) {
      const set = firedByReminder.get(e.reminder_id) ?? new Set<string>();
      set.add(e.tier);
      firedByReminder.set(e.reminder_id, set);
    }

    const newReminderEsc: Array<{ reminder_id: string; tier: ReminderTier }> = [];
    const reminderIntents: ReminderEmailIntent[] = [];

    for (const r of reminders) {
      const u = reminderUrgency({
        stakes: r.stakes,
        deadline: r.deadline,
        now,
        status: r.status,
        snoozedUntil: r.snoozed_until,
      });
      if (!u.shouldChase || u.tier === "none") continue;

      const already = firedByReminder.get(r.id) ?? new Set<string>();
      if (already.has(u.tier)) continue; // this tier already nudged — idempotent

      newReminderEsc.push({ reminder_id: r.id, tier: u.tier });
      reminderIntents.push({
        userId: r.user_id,
        title: r.title,
        tier: u.tier,
        hoursLeft: Math.round(u.hoursLeft ?? 0),
        stakes: r.stakes,
      });
      remindersFired.push({ reminderId: r.id, title: r.title, tier: u.tier });
    }

    // Record BEFORE sending so a Gmail failure can never cause a re-send next run.
    if (newReminderEsc.length > 0) {
      await db
        .from("reminder_escalations")
        .upsert(newReminderEsc, { onConflict: "reminder_id,tier", ignoreDuplicates: true });
    }
    for (const intent of reminderIntents) outbox.push({ userId: intent.userId, ...reminderEmailFor(intent) });
  }

  // ---- One autonomous send pass for tasks + reminders ----
  let notified = 0;
  if (outbox.length > 0 && googleClientId && googleClientSecret) {
    const userIds = [...new Set(outbox.map((o) => o.userId))];
    const { data: userData } = await db
      .from("users")
      .select("id, email, google_refresh_token")
      .in("id", userIds);

    const users = new Map<string, { email: string | null; token: string | null }>();
    for (const u of (userData ?? []) as Array<{
      id: string;
      email: string | null;
      google_refresh_token: string | null;
    }>) {
      users.set(u.id, { email: u.email, token: u.google_refresh_token });
    }

    const tokenCache = new Map<string, string>(); // userId → access token (one refresh per user)
    for (const msg of outbox) {
      const u = users.get(msg.userId);
      if (!u?.token || !u.email) continue;
      try {
        let accessToken = tokenCache.get(msg.userId);
        if (!accessToken) {
          const minted = await refreshAccessToken(u.token, googleClientId, googleClientSecret);
          if (!minted) continue;
          accessToken = minted;
          tokenCache.set(msg.userId, accessToken);
        }
        if (await sendGmail(accessToken, u.email, msg.subject, msg.body)) notified++;
      } catch (e) {
        console.error("escalate: nudge email failed", e);
      }
    }
  }

  return json({
    ok: true,
    ranAt: new Date().toISOString(),
    scanned: tasks.length,
    remindersScanned: reminders.length,
    fired,
    remindersFired,
    notified,
  });
});
