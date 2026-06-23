// Cadence — autonomous escalation monitor (Supabase Edge Function, Deno).
// Runs every 12h via pg_cron, and on-demand from the dashboard via /api/escalate/run.
// Pure deadline math — NO Gemini.
//
// Auth: verify_jwt is on, so the gateway has already validated a real project JWT.
// We additionally require the caller to be service-role: either the bearer equals the
// (new-format) injected service key, or its JWT `role` claim is "service_role" (the
// legacy key the proxy + cron send). This rejects anon-key / user callers.
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";

type Kind = "heads-up" | "action-needed" | "critical";

interface TaskRow {
  id: string;
  title: string;
  deadline: string;
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

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const auth = req.headers.get("Authorization") ?? "";

  const authorized = auth === `Bearer ${serviceKey}` || bearerRole(auth) === "service_role";
  if (!authorized) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const db = createClient(supabaseUrl, serviceKey);
  const now = Date.now();

  const { data: taskData, error: taskErr } = await db
    .from("tasks")
    .select("id, title, deadline")
    .eq("status", "active")
    .not("deadline", "is", null);
  if (taskErr) return json({ ok: false, error: taskErr.message }, 500);

  const tasks = (taskData ?? []) as TaskRow[];
  const ids = tasks.map((t) => t.id);
  if (ids.length === 0) {
    return json({ ok: true, ranAt: new Date().toISOString(), scanned: 0, fired: [] });
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
    for (const k of crossed) {
      if (!already.has(k)) newEscalations.push({ task_id: t.id, kind: k });
    }

    await db.from("tasks").update({ urgency: topKind }).eq("id", t.id);

    fired.push({
      taskId: t.id,
      title: t.title,
      kind: topKind,
      urgency: topKind,
      hoursLeft: Math.round(hoursLeft),
      incompleteCount,
    });
  }

  if (newEscalations.length > 0) {
    await db
      .from("escalations")
      .upsert(newEscalations, { onConflict: "task_id,kind", ignoreDuplicates: true });
  }

  return json({
    ok: true,
    ranAt: new Date().toISOString(),
    scanned: tasks.length,
    fired,
  });
});
