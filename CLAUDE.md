# CLAUDE.md — Cadence

> Working title: **Cadence** (calm, rhythm, staying on pace — fits the companion thesis). Placeholder; rename freely.
> This file is the source of truth for how this project is built. Read it fully at the start of every session. When something in a request conflicts with this file, surface the conflict before proceeding.

---

## 1. Mission (one line)

An AI productivity **companion** that helps people actually *complete* what they commit to — by planning, prioritizing, scheduling, drafting, and following up **autonomously** — for the Vibe2Ship hackathon (Coding Ninjas × Google for Developers, Problem Statement 1: "The Last-Minute Life Saver").

---

## 2. The product

**Who it's for:** students (assignments, interviews, exam prep), professionals (meetings, deliverables, follow-ups), and founders/freelancers (commitments, bills, client work). Build concrete flows for these people — never a generic, abstract to-do app.

**The core bet:** This wins or loses on one axis — **execution, not reminders.** Every competitor will build "AI-flavored reminders." The judges' matrix weights *Agentic Depth at 20%* and *Completeness at only 5%*. So Cadence must visibly **act**: it doesn't say "you should block 2 hours" — it *creates the calendar event*. It doesn't say "email your professor" — it *drafts the email and sends it on your confirmation*. If a feature only advises, it's the wrong feature.

**The feeling:** a calm companion that has your back, not a control panel that demands attention. The user should feel *"the important things are handled; I only deal with what genuinely needs me right now."*

---

## 3. Non-negotiable principles

1. **Companion, not tool.** Calm, proactive, and quiet by default. Surface the 1–3 things that need the user *now*; keep everything else out of sight until relevant. No dense grids of rows and buttons.
2. **Execution over reminders.** The agent schedules, drafts, prioritizes, reschedules, and escalates. It performs actions (with confirmation for anything that leaves the app), it doesn't just nag.
3. **Grounded in real personas/tasks.** Assignments, interviews, meetings, bills, commitments — concrete and specific. The brief's example-feature list is a *menu, not a checklist*; pick a few that sell the companion feeling and make them genuinely deep.
4. **Design: minimal, soft, deliberately un-AI.** Warm neutrals, generous whitespace, one muted accent, restraint everywhere. NO indigo/violet/electric-blue "AI SaaS" look. (See §11 for the full system and the AI-default traps to avoid.)
5. **Depth over breadth.** One flagship autonomous capability done excellently beats eight half-finished features. Completeness is 5% of scoring; agentic depth + innovation + impact are ~60% combined. Optimize accordingly.

---

## 4. Companion behavior model (what "companion not tool" means in practice)

- **Default view = "Today, handled."** The dashboard opens on a short, calm summary of what matters now and what the agent has already done/scheduled — not a backlog.
- **Proactive, not passive.** When the user adds a task, the agent immediately proposes a plan (subtasks, time blocks, any communications) rather than just storing it.
- **Confirm before crossing the boundary.** Anything that affects the outside world — sending an email, creating/modifying a real calendar event — is *drafted by the agent and confirmed by the user* in one tap. In-app state changes (prioritizing, planning) need no confirmation.
- **Escalation is autonomous.** As a deadline nears, the agent raises urgency on its own: re-sorts priorities, nudges, flags blockers, and offers to reschedule conflicting blocks — without being asked.
- **The agent has a voice.** Its messages are written in a warm, human register (see §11 voice rules). It speaks like a calm chief-of-staff, not a system log.

---

## 5. Tech stack

- **Framework:** Next.js (App Router) + TypeScript.
- **Styling:** Tailwind CSS, driven by the design tokens in §11 (define them as CSS variables + Tailwind theme extension — never hardcode hex in components).
- **AI brain:** **Gemini 2.5 Flash** via the Gemini API / Google AI Studio, using **function calling** for tool use. (Confirm the current best Flash model string in AI Studio at build time; bump to Pro only if a specific reasoning step needs it.)
- **Auth:** Google OAuth via **NextAuth.js** — a single consent flow grants Calendar + Gmail scopes *and* satisfies the "Google technologies" 15%.
- **Agent tools (external):** Google Calendar API (create/read/update events), Gmail API (draft/send), Gemini (task decomposition + document/content generation).
- **Database:** Supabase (Postgres).
- **Autonomous layer:** a server-side scheduled job (Railway cron hitting a secured Next.js route, or a Supabase Edge Function) that runs hourly to check approaching deadlines and trigger escalations.
- **Deployment:** Google AI Studio Build Mode (MANDATORY deliverable; Starter Tier is free, no billing). See §15 — exact deploy path is the one open item, confirmed at the 24 June mentor session.

**Why these:** all chosen for speed on a known stack and to maximize the "Google technologies" surface (Gemini + Calendar + Gmail + OAuth + AI Studio deploy).

---

## 6. Architecture

**One repository, two parts** (not two projects):

- **The dashboard** — Next.js pages/components the user sees.
- **The agent** — server-side: Next.js API routes that run the Gemini function-calling loop, plus the background cron that drives autonomous escalation.

They share the same codebase, the same Supabase database, and the same auth session.

```
Browser (dashboard) ──► /api/agent (Gemini loop) ──► Google Calendar / Gmail
        ▲                      │
        │                      ▼
        └──────────────── Supabase (tasks, plans, escalations)
                               ▲
        Railway cron / Edge Fn ┘  (hourly: check deadlines → escalate)
```

---

## 7. The agent loop (core flow)

```
1. User states a task in natural language ("Submit DBMS assignment by Fri 5pm")
2. Gemini parses → structured task (title, deadline, type, context)
3. Gemini decomposes → ordered subtasks + time estimates
4. Agent proposes a PLAN via tool calls:
     • get_calendar_conflicts() to find free time
     • create_calendar_block() for each work session (pending confirm)
     • draft_email() if a communication is implied (pending confirm)
5. User reviews the plan → one-tap confirm → agent executes (sends/creates)
6. Background monitor (hourly cron):
     • re-prioritizes by urgency + importance
     • escalates reminders as deadline nears
     • detects new calendar conflicts → offers reschedule
     • surfaces blockers ("you haven't started X, due in 18h")
```

**Prioritization logic:** rank by a blend of (a) time-to-deadline, (b) estimated effort remaining, (c) user-marked importance, (d) dependencies. The agent always knows "the single most important thing to do right now" and leads with it.

---

## 8. Tool schema (Gemini function-calling tools)

Keep the tool set tight — these are the only functions Gemini may call. Define each with a strict JSON schema.

```
decompose_task(title, deadline, type, context?)
    → returns ordered subtasks with effort estimates

get_calendar_conflicts(start_iso, end_iso)
    → returns busy blocks in the window

create_calendar_block(title, start_iso, end_iso, description?)
    → creates a real Google Calendar event (requires user confirm)

draft_email(to, subject, body)
    → prepares an email; NOT sent until user confirms

send_email(draft_id)
    → sends a previously drafted+confirmed email

set_escalation(task_id, schedule)
    → registers when/how the agent should nudge for this task

update_task_status(task_id, status)
    → in-app state change (no confirm needed)
```

Rule: tools that touch the outside world (`create_calendar_block`, `send_email`) must route through the confirm step. In-app tools (`update_task_status`, `set_escalation`, `decompose_task`, `get_calendar_conflicts`, `draft_email`) run freely.

---

## 9. Data model (Supabase)

```
users          id, email, name, google_refresh_token, created_at
tasks          id, user_id, title, type, deadline, importance,
               status, created_at
subtasks       id, task_id, title, effort_minutes, order, status
schedule_blocks id, task_id, gcal_event_id, start, end, status
                (status: proposed | confirmed | done | cancelled)
email_drafts   id, task_id, to, subject, body,
               status (draft | confirmed | sent), gmail_id
escalations    id, task_id, fire_at, kind, fired (bool)
```

`google_refresh_token` is sensitive — store server-side only, never expose to the client. All tables row-scoped by `user_id` (use Supabase RLS).

---

## 10. Folder structure (target)

```
/app
  /(dashboard)        → the calm main UI ("Today, handled")
  /api
    /agent            → Gemini function-calling loop
    /cron/escalate    → secured endpoint the cron hits
    /auth/[...nextauth]
/components           → UI components (all styled via design tokens)
/lib
  /gemini             → model client + tool definitions/handlers
  /google             → calendar + gmail clients
  /supabase           → db client + queries
  /agent              → planning, prioritization, escalation logic
/styles               → tokens.css (CSS variables)
CLAUDE.md
```

---

## 11. Design system

**Read this before building any UI. Treat the frontend-design skill as active for all UI work.**

**Thesis:** a calm companion. The opposite of an alarm. Soft, warm, quiet, with one place where boldness is spent.

**The signature (spend boldness HERE, keep everything else quiet):** the **"Today, handled"** hero — the dashboard opens not on a list but on a calm, human line from the companion ("You're on track. One thing needs you in the next few hours.") plus the single most important action, with everything else scheduled and tucked away. This calm-focus moment is the thing the product is remembered by.

**AI-default traps to AVOID** (do not drift into these):
- ❌ The cream-background + high-contrast-serif + terracotta-accent look (this is the #1 AI-generated cliché — we use sage, not terracotta, as the accent, and serif is used *only* for the companion's voice, with restraint).
- ❌ Indigo/violet/electric-blue gradients, glowing cards, "AI sparkle" iconography.
- ❌ Dense dashboards, numbered 01/02/03 markers (only use numbering if content is truly sequential), heavy drop-shadows, neon on near-black.

**Color tokens** (define as CSS variables; never hardcode in components):
- `--bg`: warm off-white `#FAF9F6`
- `--surface`: `#FFFFFF` with hairline borders, not shadows
- `--text`: soft warm charcoal `#2E2E2B`
- `--text-muted`: `#6B6B64`
- `--accent`: muted sage `#7E8C6E` (primary; calm "on-track")
- `--border`: `#ECEAE3` (hairline)
- State colors, all desaturated: `--due-soon` soft amber `#C99A4E`, `--on-track` soft green `#7E8C6E`, `--overdue` muted clay `#B07A5E`. States inform, never alarm.

**Typography:**
- Avoid Inter (it *is* the AI default). Body/UI: a clean humanist sans — **Geist** or **Hanken Grotesk**.
- The **companion's voice** (its spoken messages, key headings): a warm serif used sparingly — pick something with character (e.g. Source Serif or a similar warm serif), so the agent reads *human*, not systemy. Serif is a deliberate signature for the voice only — not body text, not labels.
- Set an intentional type scale; let the companion's voice be visually distinct from UI chrome.

**Layout & motion:** generous whitespace; calm, slow micro-transitions only (a gentle fade as the plan resolves). No scattered animation — extra motion reads as AI-generated. Match minimalism with precision in spacing and alignment.

**Quality floor (non-negotiable):** responsive to mobile, visible keyboard focus states, `prefers-reduced-motion` respected, sufficient contrast.

**Copy/voice rules** (copy is design material):
- Active voice; name things by what the user controls ("Reschedule," not "Update calendar block").
- An action keeps its name through the flow ("Send" → toast "Sent").
- Errors give direction, not apology ("Couldn't reach your calendar — reconnect Google to continue"). Empty states invite action.
- The companion speaks warmly and plainly, like a calm chief-of-staff — never robotic, never bubbly.

---

## 12. Coding conventions

- **TypeScript everywhere**, typed end to end (tasks, tool args, API responses). No `any` in committed code.
- **Server-side secrets only.** Refresh tokens, service keys, Gemini key never reach the client.
- **Keep it simple.** This is a one-week solo build — prefer the straightforward implementation over the clever/abstract one. No premature abstraction, no speculative config.
- **Components small and single-purpose.** UI components read from tokens; no inline hex/spacing magic numbers.
- **Error handling that surfaces, not swallows** — especially around Google API calls (auth expiry, rate limits) and Gemini tool calls (malformed function args → retry/repair).
- **Commit in working slices.** Each commit should leave the app runnable.

---

## 13. Build sequence (the week)

Build phase: **22 Jun 3pm → 29 Jun 2pm.** Submission: **29 Jun 2pm sharp** (no late entries).

- **Day 1 (today):** Kill the biggest risk first. Google OAuth working + Gemini API wired + **one function call proven end to end** (login with Google → Gemini calls `create_calendar_block` → a real event appears). Nothing else until this works.
- **Day 2–3:** The core agent loop — task input → Gemini decomposition → plan proposal → confirm → execute. The whole product, functional but unstyled.
- **Day 4–5:** The autonomous layer (the cron-driven escalation monitor — this is what makes agentic depth undeniable) + Gmail drafting/sending.
- **Day 6:** Design pass on an already-clean base — make the "Today, handled" hero sing; one polished end-to-end flow demoable in 2 minutes.
- **Day 7:** Deploy via AI Studio, write the Project Description Google Doc (problem statement, solution overview, key features, technologies, **Google technologies used** — call these out explicitly), final submit on BlockseBlock.

**24 Jun 4–6pm: mentor session** — specifically covers AI Studio build/deploy. Do not miss it.

---

## 14. Skills & modes (how to work)

- **Plan Mode before every feature.** Design the approach, tool schema, and data touched *before* writing code. This is where quality is won.
- **frontend-design skill active for all UI work** — to keep components distinctive and off the AI-default path (see §11).
- Re-read this file when starting a fresh session or feature.
- Push back when a request drifts from §3 — especially the companion feeling and the un-AI design.

---

## 15. Deployment (the one open item)

The mandatory deliverable is a **publicly accessible app deployed via Google AI Studio Build Mode** (ref: ai.google.dev/gemini-api/docs/aistudio-deploying). Starter Tier publishes up to 2 full-stack apps with **no billing/Cloud project** required — use it.

**Open question to resolve at the mentor session:** whether the canonical flow is "author/iterate the app inside AI Studio Build Mode" vs "build locally with Claude Code and deploy through AI Studio's mechanism," and how an externally-built Next.js app maps onto Build Mode deployment. Working assumption: build locally, deploy via AI Studio. Confirm before Day 7 — do not let this surprise us at the deadline.

---

## 16. Evaluation matrix (optimize for this)

| Criteria | Weight | Implication |
|---|---|---|
| Problem Solving & Impact | 20% | Solve a real persona pain, end to end |
| **Agentic Depth** | **20%** | The agent must *act* autonomously — our #1 bet |
| Innovation & Creativity | 20% | The companion framing + autonomous execution |
| Usage of Google Technologies | 15% | Gemini + Calendar + Gmail + OAuth + AI Studio |
| Product Experience & Design | 10% | The calm, un-AI dashboard |
| Technical Implementation | 10% | Clean, working code |
| Completeness & Usability | 5% | Lowest weight — don't over-invest in breadth |

Depth + innovation + impact + agentic = 80% of the score, and three of those reward exactly what we're building. Lead with autonomy and the companion experience.

---

## 17. What NOT to do

- ❌ Build a smart to-do list / reminder app. (Advising ≠ acting.)
- ❌ Try to ship all eight example features. Pick the few that prove the companion.
- ❌ Ship the generic AI look (see §11 traps).
- ❌ Send emails or create calendar events without user confirmation.
- ❌ Over-engineer, add a feature flag system, or abstract prematurely. One week, solo.
- ❌ Leave AI Studio deployment to the last day unverified.

---

## 18. Environment variables

```
GEMINI_API_KEY=            # from Google AI Studio
GOOGLE_CLIENT_ID=          # OAuth (Calendar + Gmail scopes)
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY= # server-side only
CRON_SECRET=               # protects the /api/cron/escalate route
```

OAuth note: while the Google app is in "testing," add your demo/judge accounts as test users (up to 100 allowed without verification); expect an "unverified app" warning screen — clicking through is fine for the hackathon demo.
