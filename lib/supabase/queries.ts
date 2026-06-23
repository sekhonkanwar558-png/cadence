import { getSupabaseAdmin } from "./server";
import { urgencyRank } from "@/lib/urgency";
import type {
  DashboardBlock,
  DashboardSubtask,
  DashboardTask,
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
}

/** All of a user's live tasks with subtasks + confirmed blocks, sorted most-urgent first. */
export async function listDashboardTasks(userId: string): Promise<DashboardTask[]> {
  const db = getSupabaseAdmin();

  const { data: taskData, error } = await db
    .from("tasks")
    .select("id, title, type, deadline, status, urgency, importance, is_demo")
    .eq("user_id", userId)
    .neq("status", "cancelled");
  if (error) throw new Error(`listDashboardTasks failed: ${error.message}`);

  const tasks = (taskData ?? []) as TaskRowFull[];
  if (tasks.length === 0) return [];
  const ids = tasks.map((t) => t.id);

  const [{ data: subData }, { data: blockData }] = await Promise.all([
    db.from("subtasks").select("id, task_id, title, status, effort_minutes, order").in("task_id", ids),
    db
      .from("schedule_blocks")
      .select("id, task_id, title, start, end, status, event_link")
      .in("task_id", ids)
      .eq("status", "confirmed"),
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

  const result: DashboardTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
    deadline: t.deadline,
    status: t.status,
    urgency: t.urgency,
    importance: t.importance,
    is_demo: t.is_demo,
    subtasks: (subsByTask.get(t.id) ?? []).sort((a, b) => a.order - b.order),
    blocks: (blocksByTask.get(t.id) ?? []).sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    ),
  }));

  // Most urgent first, then soonest deadline.
  return result.sort((a, b) => {
    const byUrgency = urgencyRank(b.urgency) - urgencyRank(a.urgency);
    if (byUrgency !== 0) return byUrgency;
    const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return ad - bd;
  });
}

interface DemoTaskSeed {
  title: string;
  type: string;
  hoursOut: number;
  importance: number;
  subtasks: Array<{ title: string; effort: number; status: "todo" | "done" }>;
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
