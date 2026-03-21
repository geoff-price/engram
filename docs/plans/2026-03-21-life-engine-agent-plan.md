# Life Engine Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the session-dependent life engine skill with an always-on AI agent on Vercel that provides proactive briefings and reactive coaching via Telegram.

**Architecture:** OpenAI tool-calling agent (`generateText` with tools from Vercel AI SDK) wraps existing life engine db functions. Two entry points: Vercel cron (proactive) and Telegram webhook (reactive). Single `runLifeEngine()` function handles both modes.

**Tech Stack:** Vercel AI SDK (`ai`, `@ai-sdk/openai`), OpenAI API (configurable model), Neon Postgres, grammY, Next.js API routes, Vitest.

**Design doc:** `docs/plans/2026-03-21-life-engine-agent-design.md`

---

### Task 1: Create the Life Engine Agent

**Files:**
- Create: `src/lib/life-engine-agent.ts`
- Test: `src/lib/__tests__/life-engine-agent.test.ts`

**Step 1: Write the failing test for time window detection**

```typescript
// src/lib/__tests__/life-engine-agent.test.ts
import { describe, it, expect } from "vitest";
import { getTimeWindow } from "../life-engine-agent";

describe("getTimeWindow", () => {
  it("returns morning for 7:00 AM", () => {
    expect(getTimeWindow(7, 0)).toBe("morning");
  });

  it("returns midday for 12:00 PM", () => {
    expect(getTimeWindow(12, 0)).toBe("midday");
  });

  it("returns afternoon for 3:00 PM", () => {
    expect(getTimeWindow(15, 0)).toBe("afternoon");
  });

  it("returns evening for 6:00 PM", () => {
    expect(getTimeWindow(18, 0)).toBe("evening");
  });

  it("returns quiet for 10:00 PM", () => {
    expect(getTimeWindow(22, 0)).toBe("quiet");
  });

  it("returns quiet for 3:00 AM", () => {
    expect(getTimeWindow(3, 0)).toBe("quiet");
  });

  it("returns pre_meeting at boundary 8:59 AM", () => {
    // 8:59 is still morning
    expect(getTimeWindow(8, 59)).toBe("morning");
  });

  it("returns midday at 11:00 AM", () => {
    expect(getTimeWindow(11, 0)).toBe("midday");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/life-engine-agent.test.ts`
Expected: FAIL with "getTimeWindow is not a function" or similar import error

**Step 3: Implement getTimeWindow and the full agent module**

```typescript
// src/lib/life-engine-agent.ts
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getTimezone } from "./calendar";
import {
  listHabits,
  getHabitLog,
  logHabitCompletion,
  listCheckins,
  insertCheckin,
  listBriefings,
  insertBriefing,
  insertEvolution,
  updateEvolutionStatus,
  listEvolutions,
} from "./life-engine-db";
import { listCalendarEvents, isCalendarConfigured } from "./calendar";
import { searchThoughts, listThoughts } from "./db";
import { generateEmbedding } from "./ai";
import { captureThought } from "./capture";
import { sendTelegramMessage, isTelegramSendConfigured } from "./telegram";

export type TimeWindow =
  | "morning"
  | "midday"
  | "afternoon"
  | "evening"
  | "quiet";

export function getTimeWindow(hour: number, _minute: number): TimeWindow {
  if (hour >= 6 && hour < 9) return "morning";
  if (hour >= 11 && hour < 13) return "midday";
  if (hour >= 9 && hour < 11) return "afternoon"; // late morning treated as afternoon
  if (hour >= 13 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 20) return "evening";
  return "quiet"; // 8 PM - 6 AM
}

function getModel() {
  const modelId = process.env.LIFE_ENGINE_MODEL || "gpt-4o";
  return openai(modelId);
}

const PROACTIVE_SYSTEM_PROMPT = `You are a time-aware personal assistant running on a recurring loop. Every time you are invoked, determine what the user needs RIGHT NOW based on the current time, their calendar, and their Engram knowledge base.

## Core Loop

1. **Time check** — What time is it? What time window am I in?
2. **Duplicate check** — Query list_briefings for today's entries. Do NOT send something you've already sent this cycle.
3. **Decide** — Based on the time window, what should I be doing right now?
4. **External pull** — Grab live data from integrations (calendar events). This tells you what's happening.
5. **Internal enrich** — Search Engram thoughts for context on what you just found (attendee history, meeting topics, related notes). This tells you *so what*. You can't enrich what you haven't seen yet — always external before internal.
6. **Deliver** — Use send_telegram to send the message. Only if worth it — silence is better than noise. Concise, mobile-friendly, bullet points.
7. **Log** — Record what you sent via log_briefing so the next cycle knows what's already been covered.

## Time Windows

### Morning (6:00 AM – 9:00 AM)
- Fetch today's calendar events
- Check active habits and today's completions
- Send a morning briefing via send_telegram
- Log as "morning" briefing

### Pre-Meeting (15 min before any calendar event, any time of day)
- Check calendar for events in the next 15-45 minutes
- Search Engram for attendee names and meeting topics
- Send a prep briefing
- Log as "pre_meeting" briefing

### Midday (11:00 AM – 1:00 PM)
- If no recent check-in today, send a mood/energy check-in prompt
- Log as "midday" briefing

### Afternoon (9:00 AM – 5:00 PM, outside other windows)
- Check for pre-meeting opportunities
- Otherwise, do nothing

### Evening (5:00 PM – 8:00 PM)
- Summarize the day: meetings attended, habits completed, check-in data
- Preview tomorrow's first event
- Log as "evening" briefing

### Quiet Hours (8:00 PM – 6:00 AM)
- Do nothing. Respect quiet hours.
- Exception: if a calendar event is within the next 60 minutes

## Self-Improvement Protocol

Check if today is Sunday and it's the evening window. If so, also:
- Review the past week's briefings
- Identify patterns (which briefings got responses vs. ignored)
- Propose ONE change via send_telegram
- Log the suggestion via suggest_evolution

## Message Formats

Morning:
☀️ Good morning!
📅 [N] events today:
• [Time] — [Event]
🏃 Habits: [list]

Pre-Meeting:
📋 Prep: [Event] in [N] min
👥 With: [attendees]
🧠 Context: [relevant Engram thoughts]

Midday:
💬 Quick check-in — how are you feeling? Reply with mood (1-5) and energy (1-5).

Evening:
🌙 Day wrap-up
📅 [N] meetings today
✅ Habits: [completed]/[total]
📅 Tomorrow: [first event]

## Rules

1. No duplicate briefings — always check list_briefings first.
2. Concise — the user reads on their phone. Bullet points.
3. When in doubt, do nothing. Silence is better than noise.
4. Log everything via log_briefing.
5. One evolution suggestion per week max.
6. Respect quiet hours (8 PM – 6 AM).`;

const REACTIVE_SYSTEM_PROMPT = `You are a personal assistant responding to a Telegram message. Determine what the user wants and act on it.

## Intent Detection

Analyze the message and take the appropriate action:

- **Habit confirmation** ("finished my run", "did my meditation", "worked out") → Find the matching habit via list_habits, then log_habit. Reply with encouragement and streak info.
- **Check-in** ("feeling tired", "mood 3 energy 4", "great day", "exhausted") → Extract mood and energy (1-5 scale), submit_checkin. If they only give one number or a description, infer reasonable values.
- **Evolution approval** ("yes", "approve", "do it", "sounds good") → Check for pending evolution suggestions via list_evolutions, update_evolution to approved.
- **Evolution rejection** ("no", "nah", "skip", "don't change that") → Check for pending suggestions, update_evolution to rejected.
- **Question about their data** ("how did I sleep this week", "habit streak", "what's on my calendar") → Query the relevant tools and answer.
- **Calendar question** ("what's today look like", "any meetings tomorrow") → list_calendar_events and respond.
- **Memory/thought** (anything else) → capture_thought to save it to Engram.

## Tone

Warm, concise, coach-like. Use short sentences. One or two emoji max. No walls of text.

## Rules

- Always acknowledge what you did ("Logged your run! 🏃", "Check-in saved. Mood 3, Energy 4.")
- If you're unsure about intent, capture it as a thought and confirm.
- Never ask more than one question at a time.`;

function buildTools(mode: "proactive" | "reactive") {
  const tools: Record<string, ReturnType<typeof tool>> = {};

  // Calendar
  tools.list_calendar_events = tool({
    description: "List today's or upcoming calendar events",
    parameters: z.object({
      start_date: z.string().optional().describe("YYYY-MM-DD, default today"),
      end_date: z.string().optional().describe("YYYY-MM-DD, default same as start"),
    }),
    execute: async ({ start_date, end_date }) => {
      if (!isCalendarConfigured()) return "Google Calendar is not configured.";
      const timezone = getTimezone();
      const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
      const start = start_date || today;
      const end = end_date || start;
      const events = await listCalendarEvents(start, end);
      if (events.length === 0) return `No events for ${start}.`;
      return events
        .map((e) => {
          const time = e.all_day ? "All day" : `${e.start} → ${e.end}`;
          return `• ${e.title} — ${time}${e.location ? ` (${e.location})` : ""}`;
        })
        .join("\n");
    },
  });

  // Thoughts (search)
  tools.search_thoughts = tool({
    description: "Search Engram by meaning using semantic vector search",
    parameters: z.object({
      query: z.string().describe("What to search for"),
      limit: z.number().optional().describe("Max results, default 5"),
    }),
    execute: async ({ query, limit }) => {
      const embedding = await generateEmbedding(query);
      const results = await searchThoughts(embedding, { limit: limit ?? 5 });
      if (results.length === 0) return "No matching thoughts found.";
      return results
        .map((t, i) => `${i + 1}. [${t.metadata.type}] ${t.content.slice(0, 200)}`)
        .join("\n");
    },
  });

  // Habits
  tools.list_habits = tool({
    description: "List active habits",
    parameters: z.object({}),
    execute: async () => {
      const habits = await listHabits(true);
      if (habits.length === 0) return "No active habits.";
      return habits.map((h) => `• ${h.name} (${h.frequency}) — ID: ${h.id}`).join("\n");
    },
  });

  tools.get_habit_log = tool({
    description: "View habit completion history",
    parameters: z.object({
      since: z.string().optional().describe("ISO date — only entries after this"),
      habit_id: z.string().optional(),
    }),
    execute: async ({ since, habit_id }) => {
      const entries = await getHabitLog({ habitId: habit_id, since, limit: 20 });
      if (entries.length === 0) return "No habit completions found.";
      return entries
        .map((e) => `${e.completed_at} — habit ${e.habit_id}${e.notes ? `: ${e.notes}` : ""}`)
        .join("\n");
    },
  });

  tools.log_habit = tool({
    description: "Log completion of a habit",
    parameters: z.object({
      habit_id: z.string().describe("The habit ID to log"),
      notes: z.string().optional(),
    }),
    execute: async ({ habit_id, notes }) => {
      const id = await logHabitCompletion(habit_id, notes);
      return `Habit completion logged. ID: ${id}`;
    },
  });

  // Check-ins
  tools.submit_checkin = tool({
    description: "Log a mood/energy check-in (1-5 scale each)",
    parameters: z.object({
      mood: z.number().int().min(1).max(5),
      energy: z.number().int().min(1).max(5),
      notes: z.string().optional(),
    }),
    execute: async ({ mood, energy, notes }) => {
      const id = await insertCheckin(mood, energy, notes);
      return `Check-in recorded. Mood: ${mood}/5, Energy: ${energy}/5. ID: ${id}`;
    },
  });

  tools.list_checkins = tool({
    description: "View recent check-ins",
    parameters: z.object({
      since: z.string().optional().describe("ISO date"),
      limit: z.number().optional(),
    }),
    execute: async ({ since, limit }) => {
      const checkins = await listCheckins({ since, limit });
      if (checkins.length === 0) return "No check-ins found.";
      return checkins
        .map((c) => `${c.created_at} — Mood: ${c.mood}/5, Energy: ${c.energy}/5${c.notes ? ` — ${c.notes}` : ""}`)
        .join("\n");
    },
  });

  // Briefings
  tools.list_briefings = tool({
    description: "View briefing history to check for duplicates",
    parameters: z.object({
      limit: z.number().optional(),
      type: z.enum(["morning", "pre_meeting", "midday", "evening"]).optional(),
    }),
    execute: async ({ limit, type }) => {
      const briefings = await listBriefings({ limit, type });
      if (briefings.length === 0) return "No briefings found.";
      return briefings
        .map((b) => `${b.sent_at} [${b.type}] ${b.content.slice(0, 150)}`)
        .join("\n\n");
    },
  });

  tools.log_briefing = tool({
    description: "Record that a briefing was sent (for dedup)",
    parameters: z.object({
      type: z.enum(["morning", "pre_meeting", "midday", "evening"]),
      content: z.string(),
    }),
    execute: async ({ type, content }) => {
      const id = await insertBriefing(type, content);
      return `Briefing logged (${type}). ID: ${id}`;
    },
  });

  // Evolution
  tools.suggest_evolution = tool({
    description: "Suggest a self-improvement change",
    parameters: z.object({
      change_type: z.string(),
      description: z.string(),
    }),
    execute: async ({ change_type, description }) => {
      const id = await insertEvolution(change_type, description);
      return `Evolution suggested. ID: ${id}`;
    },
  });

  tools.list_evolutions = tool({
    description: "List evolution suggestions by status",
    parameters: z.object({
      status: z.enum(["suggested", "approved", "rejected", "applied"]).optional(),
    }),
    execute: async ({ status }) => {
      const evolutions = await listEvolutions(status);
      if (evolutions.length === 0) return "No evolution suggestions found.";
      return evolutions
        .map((e) => `[${e.status}] ${e.description} (ID: ${e.id})`)
        .join("\n");
    },
  });

  tools.update_evolution = tool({
    description: "Approve, reject, or apply an evolution suggestion",
    parameters: z.object({
      evolution_id: z.string(),
      status: z.enum(["approved", "rejected", "applied"]),
    }),
    execute: async ({ evolution_id, status }) => {
      await updateEvolutionStatus(evolution_id, status);
      return `Evolution ${evolution_id} updated to ${status}.`;
    },
  });

  // Proactive-only: send telegram
  if (mode === "proactive") {
    tools.send_telegram = tool({
      description: "Send a message to the user via Telegram",
      parameters: z.object({
        text: z.string().describe("Message text to send"),
      }),
      execute: async ({ text }) => {
        if (!isTelegramSendConfigured()) return "Telegram not configured.";
        await sendTelegramMessage(text);
        return "Message sent.";
      },
    });
  }

  // Reactive-only: capture thought
  if (mode === "reactive") {
    tools.capture_thought = tool({
      description: "Save a thought/note to Engram. Use when the message doesn't match any other intent.",
      parameters: z.object({
        content: z.string(),
      }),
      execute: async ({ content }) => {
        const result = await captureThought(content, "telegram");
        const topics = result.metadata.topics.join(", ") || "none";
        let response = `Captured as ${result.metadata.type}. Topics: ${topics}.`;
        if (result.calendarResults?.length) {
          const created = result.calendarResults.filter((e) => e.status === "created");
          if (created.length > 0) {
            response += ` Also added ${created.length} event(s) to calendar.`;
          }
        }
        return response;
      },
    });
  }

  return tools;
}

export interface LifeEngineResult {
  response: string;
  actions: string[];
}

export async function runLifeEngine(options: {
  mode: "proactive" | "reactive";
  userMessage?: string;
}): Promise<LifeEngineResult> {
  const { mode, userMessage } = options;
  const timezone = getTimezone();
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", { timeZone: timezone });
  const today = now.toLocaleDateString("en-CA", { timeZone: timezone });
  const dayOfWeek = now.toLocaleDateString("en-US", { timeZone: timezone, weekday: "long" });
  const hour = parseInt(
    now.toLocaleString("en-US", { timeZone: timezone, hour: "numeric", hour12: false }),
    10,
  );
  const minute = parseInt(
    now.toLocaleString("en-US", { timeZone: timezone, minute: "numeric" }),
    10,
  );
  const window = getTimeWindow(hour, minute);

  const systemPrompt = mode === "proactive" ? PROACTIVE_SYSTEM_PROMPT : REACTIVE_SYSTEM_PROMPT;

  const contextPrefix = `Current time: ${timeStr} (${timezone})
Today: ${today} (${dayOfWeek})
Time window: ${window}
Hour: ${hour}, Minute: ${minute}`;

  const prompt =
    mode === "proactive"
      ? `${contextPrefix}\n\nRun the core loop for this time window. Check for duplicates first, then decide what to do.`
      : `${contextPrefix}\n\nUser message: "${userMessage}"\n\nDetermine intent and act on it. Return a concise response for the user.`;

  const tools = buildTools(mode);

  const result = await generateText({
    model: getModel(),
    system: systemPrompt,
    prompt,
    tools,
    maxSteps: 10,
  });

  const actions = result.steps
    .flatMap((step) => step.toolCalls)
    .map((tc) => tc.toolName);

  return {
    response: result.text,
    actions,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/life-engine-agent.test.ts`
Expected: PASS — all 8 time window tests green

**Step 5: Commit**

```bash
git add src/lib/life-engine-agent.ts src/lib/__tests__/life-engine-agent.test.ts
git commit -m "feat: add life engine agent with OpenAI tool-calling loop"
```

---

### Task 2: Create the Cron Endpoint

**Files:**
- Create: `src/app/api/cron/life-engine/route.ts`

**Step 1: Write the cron route**

```typescript
// src/app/api/cron/life-engine/route.ts
import { runLifeEngine } from "@/lib/life-engine-agent";

export const maxDuration = 60;

export async function GET(req: Request) {
  // Verify Vercel cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runLifeEngine({ mode: "proactive" });
    return Response.json({
      status: "ok",
      response: result.response,
      actions: result.actions,
    });
  } catch (err) {
    console.error("[life-engine cron] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
```

**Step 2: Verify it builds**

Run: `npx next build`
Expected: Build succeeds with no type errors

**Step 3: Commit**

```bash
git add src/app/api/cron/life-engine/route.ts
git commit -m "feat: add life engine cron endpoint"
```

---

### Task 3: Update Telegram Handler for Reactive Mode

**Files:**
- Modify: `src/app/api/telegram/route.ts` (lines 87-108 — the `message:text` handler)

**Step 1: Write a test for intent routing**

```typescript
// Add to src/lib/__tests__/life-engine-agent.test.ts

describe("reactive mode intent", () => {
  it("getTimeWindow is exported for use in cron", () => {
    // Ensures the module exports are correct
    expect(typeof getTimeWindow).toBe("function");
  });
});
```

**Step 2: Update the Telegram handler**

Replace the catch-all `bot.on("message:text")` handler in `src/app/api/telegram/route.ts`:

Old code (lines 87-108):
```typescript
  // Capture any text message
  bot.on("message:text", async (ctx) => {
    // Skip commands (already handled above)
    if (ctx.message.text.startsWith("/")) return;

    const result = await captureThought(ctx.message.text, "telegram");
    let reply: string;

    if (result.calendarResults?.length) {
      // Calendar-focused reply — skip metadata noise
      reply = "✓ Saved" + formatCalendarReceipt(result.calendarResults);
    } else {
      // Normal thought reply
      const topics = result.metadata.topics.join(", ") || "none";
      reply = `✓ Captured as ${result.metadata.type}\nTopics: ${topics}`;
      if (result.metadata.action_items.length) {
        reply += `\nAction items: ${result.metadata.action_items.join("; ")}`;
      }
    }

    await ctx.reply(reply);
  });
```

New code:
```typescript
  // Route all non-command messages through the life engine agent
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;

    try {
      const { runLifeEngine } = await import("@/lib/life-engine-agent");
      const result = await runLifeEngine({
        mode: "reactive",
        userMessage: ctx.message.text,
      });
      await ctx.reply(result.response || "✓");
    } catch (err) {
      console.error("[telegram] agent error:", err);
      // Fallback: capture as thought if agent fails
      const { captureThought } = await import("@/lib/capture");
      const result = await captureThought(ctx.message.text, "telegram");
      const topics = result.metadata.topics.join(", ") || "none";
      await ctx.reply(`✓ Captured as ${result.metadata.type}\nTopics: ${topics}`);
    }
  });
```

Note: The `captureThought` import at the top of the file and the `formatCalendarReceipt` function can stay — they're used by the photo handler and the fallback. Remove the now-unused top-level `captureThought` import only if no other handler uses it (the photo handler still does, so keep it).

**Step 3: Verify it builds**

Run: `npx next build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/app/api/telegram/route.ts
git commit -m "feat: route Telegram messages through life engine agent"
```

---

### Task 4: Update vercel.json Cron Schedule

**Files:**
- Modify: `vercel.json`

**Step 1: Update the cron config**

Old:
```json
{
  "framework": "nextjs",
  "crons": [
    {
      "path": "/api/cron/briefing",
      "schedule": "0 7 * * *"
    }
  ]
}
```

New:
```json
{
  "framework": "nextjs",
  "crons": [
    {
      "path": "/api/cron/life-engine",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

**Step 2: Commit**

```bash
git add vercel.json
git commit -m "feat: switch cron to life engine agent every 15 min"
```

---

### Task 5: Create Updated Skill File

**Files:**
- Create: `~/.claude/skills/life-engine/SKILL.md`
- Delete: `.claude/skills/life-engine.md`

**Step 1: Create the skill directory and file**

```bash
mkdir -p ~/.claude/skills/life-engine
```

Write `~/.claude/skills/life-engine/SKILL.md`:

```markdown
# /life-engine — Proactive Personal Assistant

You are Engram's Life Engine — a time-aware personal assistant running on a recurring loop. Every time this skill fires, determine what the user needs RIGHT NOW based on the current time, their calendar, and their Engram knowledge base.

## Core Loop

1. **Time check** — What time is it? What time window am I in?
2. **Duplicate check** — Use `list_briefings` (limit 5, filter by type) to see what's already been sent today. Never send the same briefing type twice in one day.
3. **Decide** — Based on the time window, what should I be doing right now?
4. **External pull** — Grab live data from integrations (calendar events, attendee lists). This tells you what's happening.
5. **Internal enrich** — Search Engram thoughts for context on what you just found (attendee history, meeting topics, related notes). This tells you *so what*. You can't enrich what you haven't seen yet — always external before internal.
6. **Deliver** — Use `send_message` with the briefing text. Only if worth it — silence is better than noise. Concise, mobile-friendly, bullet points.
7. **Log** — Record what you sent via `log_briefing` so the next cycle knows what's already been covered.

## Available MCP Tools

Use the Engram MCP server tools:
- `list_calendar_events` — today's schedule
- `search_thoughts` — semantic search across all captured thoughts
- `list_thoughts` — browse recent thoughts
- `capture_thought` — save observations
- `list_habits` / `log_habit` / `get_habit_log` — habit tracking
- `submit_checkin` / `list_checkins` — mood/energy check-ins
- `log_briefing` / `list_briefings` — briefing dedup tracking
- `suggest_evolution` / `update_evolution` — self-improvement
- `send_message` — proactive Telegram messages

## Time Windows

### Morning (6:00 AM – 9:00 AM)
- `list_calendar_events` for today
- `list_habits` to see what needs tracking
- `search_thoughts` for context on today's meetings
- Compose a warm, concise morning briefing
- `send_message` to deliver it
- `log_briefing` (type: morning)

### Pre-Meeting (15 min before any event)
- `list_calendar_events` for the next 2 hours
- For each upcoming meeting: `search_thoughts` for attendee names, project names
- Send a prep briefing with relevant context
- `log_briefing` (type: pre_meeting)

### Midday (11:00 AM – 1:00 PM)
- `list_habits` + `get_habit_log` (since: today) to check progress
- Prompt for mood/energy if no check-in today (`list_checkins` since today)
- `send_message` with a gentle check-in prompt
- `log_briefing` (type: midday)

### Evening (5:00 PM – 8:00 PM)
- `list_thoughts` (since: today) to review the day
- `get_habit_log` (since: today) for habit completion summary
- `list_checkins` (since: today) for mood/energy data
- Compose a day summary
- `send_message` to deliver it
- `log_briefing` (type: evening)

### Quiet Hours (8:00 PM – 6:00 AM)
- Do nothing. Skip this iteration.

### Outside Windows
- Check for pre-meeting opportunities (events in next 15 minutes)
- Otherwise, do nothing

## Self-Improvement Protocol (Sundays, evening window)

- `list_briefings` (limit: 30) to review the week
- `list_checkins` (limit: 14) for mood/energy trends
- `get_habit_log` (since: 7 days ago) for habit streaks
- Analyze patterns and suggest ONE improvement
- `suggest_evolution` for any changes worth making

## Message Formats

Morning:
☀️ Good morning!
📅 [N] events today:
• [Time] — [Event]
🏃 Habits: [list]

Pre-Meeting:
📋 Prep: [Event] in [N] min
👥 With: [attendees]
🧠 Context: [relevant thoughts]

Midday:
💬 Quick check-in — how are you feeling? Reply with mood (1-5) and energy (1-5).

Evening:
🌙 Day wrap-up
📅 [N] meetings today
✅ Habits: [completed]/[total]
📅 Tomorrow: [first event]

## Rules

1. No duplicate briefings — always check `list_briefings` first.
2. Concise — the user reads on their phone.
3. When in doubt, do nothing. Silence > noise.
4. Log everything via `log_briefing`.
5. One evolution suggestion per week max.
6. Respect quiet hours (8 PM – 6 AM).
```

**Step 2: Remove old skill file**

```bash
rm .claude/skills/life-engine.md
rmdir .claude/skills 2>/dev/null  # remove if empty
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: install life engine skill at ~/.claude/skills/life-engine/SKILL.md"
```

Note: The `~/.claude/skills/` file is outside the repo. Only the removal of `.claude/skills/life-engine.md` is tracked in git.

---

### Task 6: Remove Old Briefing Cron

**Files:**
- Delete: `src/app/api/cron/briefing/route.ts`

**Step 1: Delete the old cron endpoint**

```bash
rm src/app/api/cron/briefing/route.ts
rmdir src/app/api/cron/briefing
```

**Step 2: Verify build still works**

Run: `npx next build`
Expected: Build succeeds (vercel.json no longer references this path)

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove old briefing cron, replaced by life-engine agent"
```

---

### Task 7: Add LIFE_ENGINE_MODEL to Environment

**Files:** None (Vercel dashboard)

**Step 1: Add the env var in Vercel**

Go to Vercel dashboard → engram project → Settings → Environment Variables:

```
LIFE_ENGINE_MODEL=gpt-4o
```

This can be changed to any OpenAI model string (`gpt-4.1`, `gpt-4o-mini`, `o3`, etc.) without redeploying.

**Step 2: Verify locally**

```bash
echo 'LIFE_ENGINE_MODEL=gpt-4o' >> .env.local
```

---

### Task 8: End-to-End Manual Testing

**Step 1: Test proactive mode locally**

```bash
curl -X GET http://localhost:3000/api/cron/life-engine \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected: JSON response with `status: "ok"`, `actions` array showing which tools were called, and `response` with the agent's reasoning.

**Step 2: Test reactive mode via Telegram**

Send these messages to your bot and verify responses:

| Message | Expected Behavior |
|---------|------------------|
| "finished my run" | Lists habits, logs the matching one, replies with confirmation |
| "mood 4 energy 3" | Logs check-in, replies "Check-in saved. Mood 4/5, Energy 3/5." |
| "what's on my calendar today" | Lists calendar events |
| "Jonah has baseball practice at 4pm tomorrow" | Captures thought + creates calendar event |
| "yes" (after an evolution suggestion) | Approves the pending suggestion |

**Step 3: Test quiet hours**

Change system clock or wait until after 8 PM, trigger cron. Expected: agent does nothing, returns empty actions.

**Step 4: Deploy**

```bash
git push
```

Vercel auto-deploys. Verify cron fires every 15 minutes in Vercel dashboard → Cron Jobs.

---

## Environment Variables Summary

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `LIFE_ENGINE_MODEL` | No | `gpt-4o` | Any OpenAI model string |
| `CRON_SECRET` | Yes | — | Already configured |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Already configured |
| `TELEGRAM_CHAT_ID` | Yes | — | Already configured |
| `DATABASE_URL` | Yes | — | Already configured |
| `OPENAI_API_KEY` | Yes | — | Already configured |
| `GOOGLE_CLIENT_ID` | Yes | — | Already configured |
| `GOOGLE_CLIENT_SECRET` | Yes | — | Already configured |
| `GOOGLE_REFRESH_TOKEN` | Yes | — | Already configured |
| `CALENDAR_TIMEZONE` | No | `America/New_York` | Already configured |

No new env vars required except the optional `LIFE_ENGINE_MODEL`.
