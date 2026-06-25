import { getSupabaseAdmin } from "./server";
import { urgencyRank } from "@/lib/urgency";
import type {
  DashboardBlock,
  DashboardDraft,
  DashboardSubtask,
  DashboardTask,
  DraftStatus,
  ProposedBlock,
  ProposedEmail,
  Subtask,
  TaskInput,
  TaskStatus,
  Urgency,
} from "@/lib/types";

export async function upsertUser(email: string, name?: string | null): Promise<string> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("users")
    .upsert({ email, name: name ?? null }, { onConflict: "email" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`upsertUser failed: ${error?.message ?? "no row"}`);
  return (data as { id: string }).id;
}

/** Store the user's Google refresh token for offline server-side Google calls. */
export async function saveRefreshToken(email: string, refreshToken: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("users")
    .update({ google_refresh_token: refreshToken })
    .eq("email", email);
  if (error) throw new Error(`saveRefreshToken failed: ${error.message}`);
}

export interface TaskRow {
  id: string;
  title: string;
  type: string | null;
  deadline: string | null;
  importance: number;
  status: TaskStatus;
}

export interface InsertPlanArgs {
  userId: string;
  task: TaskInput;
  subtasks: Subtask[];
  blocks: ProposedBlock[];
  email: ProposedEmail | null;
}

export interface InsertedPlan {
  taskId: string;
  taskRow: TaskRow;
  blocks: Array<ProposedBlock & { id: string }>;
  email: (ProposedEmail & { id: string }) | null;
}

/** Persist a freshly proposed plan: task + subtasks + staged blocks + optional draft. */
export async function insertProposedPlan(args: InsertPlanArgs): Promise<InsertedPlan> {
  const db = getSupabaseAdmin();

  const { data: taskData, error: taskErr } = await db
    .from("tasks")
    .insert({
      user_id: args.userId,
      title: args.task.title,
      type: args.task.type ?? null,
      deadline: args.task.deadline ?? null,
      importance: args.task.importance ?? 3,
      status: "proposed",
    })
    .select("id, title, type, deadline, importance, status")
    .single();
  if (taskErr || !taskData) throw new Error(`insert task failed: ${taskErr?.message ?? "no row"}`);
  const taskRow = taskData as TaskRow;
  const taskId = taskRow.id;

  if (args.subtasks.length) {
    const { error } = await db.from("subtasks").insert(
      args.subtasks.map((s) => ({
        task_id: taskId,
        title: s.title,
        effort_minutes: s.effort_minutes,
        order: s.order,
        status: "todo",
      })),
    );
    if (error) throw new Error(`insert subtasks failed: ${error.message}`);
  }

  let blocksWithId: Array<ProposedBlock & { id: string }> = [];
  if (args.blocks.length) {
    const { data, error } = await db
      .from("schedule_blocks")
      .insert(
        args.blocks.map((b) => ({
          task_id: taskId,
          title: b.title,
          start: b.start_iso,
          end: b.end_iso,
          description: b.description ?? null,
          status: "proposed",
        })),
      )
      .select("id");
    if (error || !data) throw new Error(`insert blocks failed: ${error?.message ?? "no rows"}`);
    const ids = data as Array<{ id: string }>;
    // PostgREST returns inserted rows in input order.
    blocksWithId = args.blocks.map((b, i) => ({ ...b, id: ids[i].id }));
  }

  let emailWithId: (ProposedEmail & { id: string }) | null = null;
  if (args.email) {
    const { data, error } = await db
      .from("email_drafts")
      .insert({
        task_id: taskId,
        to: args.email.to,
        subject: args.email.subject,
        body: args.email.body,
        status: "draft",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert email draft failed: ${error?.message ?? "no row"}`);
    emailWithId = { ...args.email, id: (data as { id: string }).id };
  }

  return { taskId, taskRow, blocks: blocksWithId, email: emailWithId };
}

export interface ConfirmTarget {
  task: { id: string; title: string };
  blocks: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    description: string | null;
  }>;
}

/** Load a task's proposed blocks for confirmation, verifying the task belongs to the user. */
export async function getProposedPlanForConfirm(
  taskId: string,
  userId: string,
): Promise<ConfirmTarget | null> {
  const db = getSupabaseAdmin();

  const { data: task, error: tErr } = await db
    .from("tasks")
    .select("id, title, user_id")
    .eq("id", taskId)
    .single();
  if (tErr || !task) return null;
  if ((task as { user_id: string }).user_id !== userId) return null;

  const { data: blocks, error: bErr } = await db
    .from("schedule_blocks")
    .select("id, title, start, end, description")
    .eq("task_id", taskId)
    .eq("status", "proposed");
  if (bErr) throw new Error(`load blocks failed: ${bErr.message}`);

  return {
    task: { id: (task as { id: string }).id, title: (task as { title: string }).title },
    blocks: (blocks ?? []) as ConfirmTarget["blocks"],
  };
}

export async function markBlockConfirmed(
  blockId: string,
  gcalEventId: string,
  eventLink: string,
): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("schedule_blocks")
    .update({ status: "confirmed", gcal_event_id: gcalEventId, event_link: eventLink })
    .eq("id", blockId);
  if (error) throw new Error(`confirm block failed: ${error.message}`);
}

export async function markTaskActive(taskId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("tasks").update({ status: "active" }).eq("id", taskId);
  if (error) throw new Error(`activate task failed: ${error.message}`);
}

/** Confirmed blocks for a task that have a real Calendar event — for cleanup on completion. */
export async function getConfirmedBlocks(
  taskId: string,
): Promise<Array<{ id: string; gcalEventId: string; start: string }>> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("schedule_blocks")
    .select("id, gcal_event_id, start")
    .eq("task_id", taskId)
    .eq("status", "confirmed")
    .not("gcal_event_id", "is", null);
  if (error) throw new Error(`load confirmed blocks failed: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; gcal_event_id: string; start: string }>).map((b) => ({
    id: b.id,
    gcalEventId: b.gcal_event_id,
    start: b.start,
  }));
}

/** Mark a block cancelled — used after its Calendar event is deleted on completion. */
export async function markBlockCancelled(blockId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("schedule_blocks")
    .update({ status: "cancelled" })
    .eq("id", blockId);
  if (error) throw new Error(`cancel block failed: ${error.message}`);
}

// ---- Day 3: dashboard, demo seed, reschedule ----

interface TaskRowFull {
  id: string;
  title: string;
  type: string | null;
  deadline: string | null;
  status: TaskStatus;
  urgency: Urgency;
  importance: number;
  is_demo: boolean;
  completed_at: string | null;
  source: string;
  event_type: string;
}

/**
 * A user's tasks with subtasks + confirmed blocks. Defaults to the live board
 * (status='active'), sorted most-urgent first; pass status='completed' for the
 * history view, sorted by completion time (newest first).
 */
export async function listDashboardTasks(
  userId: string,
  status: TaskStatus = "active",
): Promise<DashboardTask[]> {
  const db = getSupabaseAdmin();

  const { data: taskData, error } = await db
    .from("tasks")
    .select(
      "id, title, type, deadline, status, urgency, importance, is_demo, completed_at, source, event_type",
    )
    .eq("user_id", userId)
    .eq("status", status);
  if (error) throw new Error(`listDashboardTasks failed: ${error.message}`);

  const tasks = (taskData ?? []) as TaskRowFull[];
  if (tasks.length === 0) return [];
  const ids = tasks.map((t) => t.id);

  const [{ data: subData }, { data: blockData }, { data: draftData }] = await Promise.all([
    db.from("subtasks").select("id, task_id, title, status, effort_minutes, order").in("task_id", ids),
    db
      .from("schedule_blocks")
      .select("id, task_id, title, start, end, status, event_link")
      .in("task_id", ids)
      .eq("status", "confirmed"),
    db
      .from("email_drafts")
      .select("id, task_id, to, subject, body, status, gmail_id")
      .in("task_id", ids),
  ]);

  const subsByTask = new Map<string, DashboardSubtask[]>();
  for (const s of (subData ?? []) as Array<DashboardSubtask & { task_id: string }>) {
    const list = subsByTask.get(s.task_id) ?? [];
    list.push({ id: s.id, title: s.title, status: s.status, effort_minutes: s.effort_minutes, order: s.order });
    subsByTask.set(s.task_id, list);
  }

  const blocksByTask = new Map<string, DashboardBlock[]>();
  for (const b of (blockData ?? []) as Array<DashboardBlock & { task_id: string }>) {
    const list = blocksByTask.get(b.task_id) ?? [];
    list.push({ id: b.id, title: b.title, start: b.start, end: b.end, status: b.status, event_link: b.event_link });
    blocksByTask.set(b.task_id, list);
  }

  const draftsByTask = new Map<string, DashboardDraft[]>();
  for (const d of (draftData ?? []) as Array<DashboardDraft & { task_id: string }>) {
    const list = draftsByTask.get(d.task_id) ?? [];
    list.push({ id: d.id, to: d.to, subject: d.subject, body: d.body, status: d.status, gmail_id: d.gmail_id });
    draftsByTask.set(d.task_id, list);
  }

  const result: DashboardTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
    deadline: t.deadline,
    status: t.status,
    urgency: t.urgency,
    importance: t.importance,
    is_demo: t.is_demo,
    completed_at: t.completed_at,
    source: t.source,
    event_type: t.event_type,
    subtasks: (subsByTask.get(t.id) ?? []).sort((a, b) => a.order - b.order),
    blocks: (blocksByTask.get(t.id) ?? []).sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    ),
    drafts: draftsByTask.get(t.id) ?? [],
  }));

  // History: most recently completed first.
  if (status === "completed") {
    return result.sort(
      (a, b) =>
        (b.completed_at ? new Date(b.completed_at).getTime() : 0) -
        (a.completed_at ? new Date(a.completed_at).getTime() : 0),
    );
  }

  // Live board: most urgent first, then soonest deadline.
  return result.sort((a, b) => {
    const byUrgency = urgencyRank(b.urgency) - urgencyRank(a.urgency);
    if (byUrgency !== 0) return byUrgency;
    const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return ad - bd;
  });
}

/**
 * Move a task to history: mark it completed and stamp completed_at. Scoped to the
 * owner (admin client bypasses RLS) — a non-matching id/user throws "Task not found".
 */
export async function completeTask(taskId: string, userId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("user_id", userId)
    .select("id")
    .single();
  if (error || !data) throw new Error("Task not found.");
}

/**
 * Toggle a subtask done/undone, scoped to its owner. The admin client bypasses
 * RLS, so ownership is enforced here via the parent task's user_id. Stamps
 * completed_at on completion and clears it on undo — this is what lets real
 * history (and the companion's personalization) accumulate honestly over time.
 */
export async function setSubtaskDone(
  subtaskId: string,
  userId: string,
  done: boolean,
): Promise<void> {
  const db = getSupabaseAdmin();

  const { data: sub, error: subErr } = await db
    .from("subtasks")
    .select("id, task_id")
    .eq("id", subtaskId)
    .single();
  if (subErr || !sub) throw new Error("Subtask not found.");

  const { data: task, error: taskErr } = await db
    .from("tasks")
    .select("id")
    .eq("id", (sub as { task_id: string }).task_id)
    .eq("user_id", userId)
    .single();
  if (taskErr || !task) throw new Error("Subtask not found.");

  const { error: updErr } = await db
    .from("subtasks")
    .update({
      status: done ? "done" : "todo",
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq("id", subtaskId);
  if (updErr) throw new Error(`update subtask failed: ${updErr.message}`);
}

interface DemoTaskSeed {
  title: string;
  type: string;
  hoursOut: number;
  importance: number;
  subtasks: Array<{ title: string; effort: number; status: "todo" | "done" }>;
  email?: { to: string; subject: string; body: string };
}

const DEMO_TASKS: DemoTaskSeed[] = [
  {
    title: "Final-round interview prep",
    type: "interview",
    hoursOut: 6,
    importance: 5,
    subtasks: [
      { title: "Review system design notes", effort: 60, status: "todo" },
      { title: "Mock interview run-through", effort: 45, status: "todo" },
      { title: "Re-read the job description", effort: 15, status: "done" },
    ],
    email: {
      to: "alex.recruiter@northwind.example",
      subject: "Confirming tomorrow's final-round interview",
      body:
        "Hi Alex,\n\n" +
        "Just confirming I'll be ready for the final-round interview tomorrow — looking " +
        "forward to it. If there's anything you'd like me to prepare or bring along, " +
        "happy to sort it out beforehand.\n\n" +
        "Thanks again for the opportunity.\n\nBest,\nKanwar",
    },
  },
  {
    title: "DBMS assignment",
    type: "assignment",
    hoursOut: 24,
    importance: 4,
    subtasks: [
      { title: "Draw the ER diagram", effort: 60, status: "done" },
      { title: "Normalize the schema to 3NF", effort: 50, status: "todo" },
    ],
  },
  {
    title: "Resume rewrite",
    type: "career",
    hoursOut: 48,
    importance: 3,
    subtasks: [
      { title: "Draft a new summary", effort: 40, status: "todo" },
      { title: "Update experience bullets", effort: 50, status: "todo" },
    ],
  },
  {
    title: "Pay the electricity bill",
    type: "bill",
    hoursOut: 24 * 7,
    importance: 2,
    subtasks: [
      { title: "Log in to the portal", effort: 5, status: "done" },
      { title: "Make the payment", effort: 5, status: "done" },
    ],
  },
];

/** Idempotent demo seed: clears prior demo data, then writes a deterministic set. */
export async function seedDemo(userId: string): Promise<void> {
  const db = getSupabaseAdmin();

  // Cascade clears subtasks / blocks / escalations for these tasks.
  const { error: delErr } = await db
    .from("tasks")
    .delete()
    .eq("user_id", userId)
    .eq("is_demo", true);
  if (delErr) throw new Error(`clear demo failed: ${delErr.message}`);

  const now = Date.now();
  for (const t of DEMO_TASKS) {
    const { data: task, error } = await db
      .from("tasks")
      .insert({
        user_id: userId,
        title: t.title,
        type: t.type,
        deadline: new Date(now + t.hoursOut * 3600000).toISOString(),
        importance: t.importance,
        status: "active",
        urgency: "none",
        is_demo: true,
      })
      .select("id")
      .single();
    if (error || !task) throw new Error(`seed task failed: ${error?.message ?? "no row"}`);
    const taskId = (task as { id: string }).id;

    const { error: subErr } = await db.from("subtasks").insert(
      t.subtasks.map((s, i) => ({
        task_id: taskId,
        title: s.title,
        effort_minutes: s.effort,
        order: i + 1,
        status: s.status,
      })),
    );
    if (subErr) throw new Error(`seed subtasks failed: ${subErr.message}`);

    if (t.email) {
      const { error: emailErr } = await db.from("email_drafts").insert({
        task_id: taskId,
        to: t.email.to,
        subject: t.email.subject,
        body: t.email.body,
        status: "draft",
      });
      if (emailErr) throw new Error(`seed email draft failed: ${emailErr.message}`);
    }
  }
}

export interface RescheduleTarget {
  task: { id: string; title: string; deadline: string | null };
  incompleteSubtasks: Array<{ title: string; effort_minutes: number | null }>;
}

export async function getTaskForReschedule(
  taskId: string,
  userId: string,
): Promise<RescheduleTarget | null> {
  const db = getSupabaseAdmin();

  const { data: task, error } = await db
    .from("tasks")
    .select("id, title, deadline, user_id")
    .eq("id", taskId)
    .single();
  if (error || !task) return null;
  const row = task as { id: string; title: string; deadline: string | null; user_id: string };
  if (row.user_id !== userId) return null;

  const { data: subs } = await db
    .from("subtasks")
    .select("title, effort_minutes, status")
    .eq("task_id", taskId)
    .neq("status", "done");

  return {
    task: { id: row.id, title: row.title, deadline: row.deadline },
    incompleteSubtasks: ((subs ?? []) as Array<{ title: string; effort_minutes: number | null }>).map(
      (s) => ({ title: s.title, effort_minutes: s.effort_minutes }),
    ),
  };
}

export async function insertConfirmedBlock(args: {
  taskId: string;
  title: string;
  startIso: string;
  endIso: string;
  description?: string | null;
  gcalEventId: string;
  eventLink: string;
}): Promise<string> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("schedule_blocks")
    .insert({
      task_id: args.taskId,
      title: args.title,
      start: args.startIso,
      end: args.endIso,
      description: args.description ?? null,
      status: "confirmed",
      gcal_event_id: args.gcalEventId,
      event_link: args.eventLink,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insert confirmed block failed: ${error?.message ?? "no row"}`);
  return (data as { id: string }).id;
}

export interface EmailDraftForSend {
  id: string;
  to: string | null;
  subject: string | null;
  body: string | null;
  status: DraftStatus;
}

/** Load an email draft for sending, verifying its task belongs to the user. */
export async function getEmailDraftForSend(
  draftId: string,
  userId: string,
): Promise<EmailDraftForSend | null> {
  const db = getSupabaseAdmin();

  const { data: draft, error } = await db
    .from("email_drafts")
    .select("id, to, subject, body, status, task_id")
    .eq("id", draftId)
    .single();
  if (error || !draft) return null;
  const row = draft as EmailDraftForSend & { task_id: string | null };
  if (!row.task_id) return null;

  const { data: task } = await db
    .from("tasks")
    .select("user_id")
    .eq("id", row.task_id)
    .single();
  if (!task || (task as { user_id: string }).user_id !== userId) return null;

  return { id: row.id, to: row.to, subject: row.subject, body: row.body, status: row.status };
}

export async function markDraftSent(
  draftId: string,
  args: { to: string; subject: string; body: string; gmailId: string },
): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("email_drafts")
    .update({
      to: args.to,
      subject: args.subject,
      body: args.body,
      status: "sent",
      gmail_id: args.gmailId,
    })
    .eq("id", draftId);
  if (error) throw new Error(`mark draft sent failed: ${error.message}`);
}

export interface UserHistory {
  tasks: Array<{ type: string | null; created_at: string }>;
  incompleteSubtaskTitles: string[];
}

/** Recent task history (last 30 days) used to build the personalization context (§4). */
export async function getUserHistory(userId: string): Promise<UserHistory> {
  const db = getSupabaseAdmin();
  const since = new Date(Date.now() - 30 * 24 * 3600000).toISOString();

  const { data: taskData } = await db
    .from("tasks")
    .select("id, type, created_at")
    .eq("user_id", userId)
    .gte("created_at", since);

  const tasks = (taskData ?? []) as Array<{ id: string; type: string | null; created_at: string }>;
  if (tasks.length === 0) return { tasks: [], incompleteSubtaskTitles: [] };

  const { data: subData } = await db
    .from("subtasks")
    .select("title, status, task_id")
    .in("task_id", tasks.map((t) => t.id))
    .neq("status", "done");

  return {
    tasks: tasks.map((t) => ({ type: t.type, created_at: t.created_at })),
    incompleteSubtaskTitles: ((subData ?? []) as Array<{ title: string }>).map((s) => s.title),
  };
}

// ---- Day 7: Google Calendar → Cadence sync ----

export interface ImportDedupIds {
  /** Google event ids already imported as tasks (this user). */
  importedEventIds: Set<string>;
  /** Google event ids Cadence itself created (its confirmed work-blocks) — always skip. */
  cadenceEventIds: Set<string>;
}

/** Ids to skip when importing, so sync is idempotent and never re-imports our own blocks. */
export async function getImportDedupIds(userId: string): Promise<ImportDedupIds> {
  const db = getSupabaseAdmin();

  const { data: taskData, error } = await db
    .from("tasks")
    .select("id, google_event_id")
    .eq("user_id", userId);
  if (error) throw new Error(`getImportDedupIds tasks failed: ${error.message}`);

  const tasks = (taskData ?? []) as Array<{ id: string; google_event_id: string | null }>;
  const importedEventIds = new Set<string>();
  for (const t of tasks) if (t.google_event_id) importedEventIds.add(t.google_event_id);

  const cadenceEventIds = new Set<string>();
  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length) {
    const { data: blockData, error: bErr } = await db
      .from("schedule_blocks")
      .select("gcal_event_id")
      .in("task_id", taskIds)
      .not("gcal_event_id", "is", null);
    if (bErr) throw new Error(`getImportDedupIds blocks failed: ${bErr.message}`);
    for (const b of (blockData ?? []) as Array<{ gcal_event_id: string | null }>) {
      if (b.gcal_event_id) cadenceEventIds.add(b.gcal_event_id);
    }
  }

  return { importedEventIds, cadenceEventIds };
}

export interface ImportTaskArgs {
  userId: string;
  title: string;
  deadline: string | null;
  type: string | null;
  /** 'deadline' | 'meeting' — drives how the card renders. */
  eventType: string;
  googleEventId: string;
  /** Origin tag: 'google_calendar' (default) | 'google_task'. */
  source?: string;
  /** Empty for meetings (surfaced as context only). */
  subtasks: Subtask[];
}

/**
 * Insert a task imported from Google Calendar: active immediately, tagged with its
 * origin so completing it never deletes the user's real event. Idempotent against
 * the (user_id, google_event_id) unique index — a duplicate import is a no-op.
 */
export async function insertImportedTask(args: ImportTaskArgs): Promise<string | null> {
  const db = getSupabaseAdmin();

  const { data: taskData, error } = await db
    .from("tasks")
    .insert({
      user_id: args.userId,
      title: args.title,
      type: args.type,
      deadline: args.deadline,
      importance: 3,
      status: "active",
      urgency: "none",
      source: args.source ?? "google_calendar",
      google_event_id: args.googleEventId,
      event_type: args.eventType,
    })
    .select("id")
    .single();
  // 23505 = unique violation (already imported by a concurrent sync) — treat as a no-op.
  if (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw new Error(`insertImportedTask failed: ${error.message}`);
  }
  const taskId = (taskData as { id: string }).id;

  if (args.subtasks.length) {
    const { error: subErr } = await db.from("subtasks").insert(
      args.subtasks.map((s) => ({
        task_id: taskId,
        title: s.title,
        effort_minutes: s.effort_minutes,
        order: s.order,
        status: "todo",
      })),
    );
    if (subErr) throw new Error(`insertImportedTask subtasks failed: ${subErr.message}`);
  }

  return taskId;
}

export async function setCalendarSyncedAt(userId: string): Promise<string> {
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await db.from("users").update({ calendar_synced_at: now }).eq("id", userId);
  if (error) throw new Error(`setCalendarSyncedAt failed: ${error.message}`);
  return now;
}

export async function getCalendarSyncedAt(userId: string): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("users")
    .select("calendar_synced_at")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`getCalendarSyncedAt failed: ${error.message}`);
  return (data as { calendar_synced_at: string | null }).calendar_synced_at;
}
