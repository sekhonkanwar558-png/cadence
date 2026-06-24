// Cadence — autonomous escalation monitor (Supabase Edge Function, Deno).
// Runs every 12h via pg_cron, and on-demand from the dashboard via /api/escalate/run.
// Pure deadline math — NO Gemini.
//
// Day 7: the monitor now ACTS. When a task crosses a new escalation threshold, it
// sends a real Gmail nudge to the user using their stored google_refresh_token
// (minted to a fresh access token via the OAuth2 refresh flow). One email per task
// per run, for the highest newly-crossed tier; the (task_id,kind) unique constraint
// makes it idempotent, so the cron never re-sends the same nudge.
//
// Auth: verify_jwt is on, so the gateway has already validated a real project JWT.
// We additionally require the caller to be service-role: either the bearer equals the
// (new-format) injected service key, or its JWT `role` claim is "service_role" (the
// legacy key the proxy + cron send). This rejects anon-key / user callers.
//
// Secrets required (in addition to the injected SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  — for the OAuth2 refresh flow.
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";

type Kind = "heads-up" | "action-needed" | "critical";

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
interface EmailIntent {
  userId: string;
  title: string;
  kind: Kind;
  hoursLeft: number;
  incompleteCount: number;
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
    // Strip CR/LF so a task title can never inject extra headers.
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

/** Templated companion-voice nudge, varied by tier. Subjects kept ASCII-safe. */
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

  const { data: taskData, error: taskErr } = await db
    .from("tasks")
    .select("id, title, deadline, user_id")
    .eq("status", "active")
    .not("deadline", "is", null);
  if (taskErr) return json({ ok: false, error: taskErr.message }, 500);

  const tasks = (taskData ?? []) as TaskRow[];
  const ids = tasks.map((t) => t.id);
  if (ids.length === 0) {
    return json({ ok: true, ranAt: new Date().toISOString(), scanned: 0, fired: [], notified: 0 });
  }

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

  const fired: Array<{
    taskId: string;
    title: string;
    kind: Kind;
    urgency: Kind;
    hoursLeft: number;
    incompleteCount: number;
  }> = [];

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

    // Queue one email for the highest newly-crossed tier (skip if nothing new fired).
    if (newKinds.length > 0) {
      emailIntents.push({
        userId: t.user_id,
        title: t.title,
        kind: newKinds[newKinds.length - 1],
        hoursLeft: Math.round(hoursLeft),
        incompleteCount,
      });
    }

    fired.push({
      taskId: t.id,
      title: t.title,
      kind: topKind,
      urgency: topKind,
      hoursLeft: Math.round(hoursLeft),
      incompleteCount,
    });
  }

  // Record escalation rows FIRST so a Gmail failure can never cause a re-send next run.
  if (newEscalations.length > 0) {
    await db
      .from("escalations")
      .upsert(newEscalations, { onConflict: "task_id,kind", ignoreDuplicates: true });
  }

  // Autonomous nudge: email the user for each newly-crossed escalation (best-effort).
  let notified = 0;
  if (emailIntents.length > 0 && googleClientId && googleClientSecret) {
    const userIds = [...new Set(emailIntents.map((e) => e.userId))];
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
    for (const intent of emailIntents) {
      const u = users.get(intent.userId);
      if (!u?.token || !u.email) continue;
      try {
        let accessToken = tokenCache.get(intent.userId);
        if (!accessToken) {
          const minted = await refreshAccessToken(u.token, googleClientId, googleClientSecret);
          if (!minted) continue;
          accessToken = minted;
          tokenCache.set(intent.userId, accessToken);
        }
        const { subject, body } = emailFor(intent);
        if (await sendGmail(accessToken, u.email, subject, body)) notified++;
      } catch (e) {
        console.error("escalate: nudge email failed", e);
      }
    }
  }

  return json({
    ok: true,
    ranAt: new Date().toISOString(),
    scanned: tasks.length,
    fired,
    notified,
  });
});
