# Life Engine Agent — Design Document

**Date:** 2026-03-21
**Status:** Approved
**Reference:** [OB1 Life Engine Recipe](https://github.com/NateBJones-Projects/OB1/tree/main/recipes/life-engine)

## Problem

The current life engine is a Claude Code skill that only works when Claude Code is running locally. Proactive briefings depend on a local `/loop` session. Inbound Telegram messages go through a simple capture-thought handler with no coaching or conversational intelligence. There is no reactive interaction — the user can't reply to a briefing and have the system act on it.

## Solution

Replace the session-dependent skill with an **always-on AI agent** running on Vercel. The agent uses OpenAI's tool-calling API to reason about what to do, wrapping the existing life engine database functions as tools. It operates in two modes:

- **Proactive** — Vercel cron triggers the agent every 15 minutes. The agent runs the OB1 7-step loop (time check, dedup, decide, external pull, internal enrich, deliver, log) and sends briefings when appropriate.
- **Reactive** — When the user sends a Telegram message, the bot routes it through the agent. The agent determines intent (habit confirmation, check-in, evolution approval, thought capture, question) and responds conversationally.

The Claude Code skill file at `~/.claude/skills/life-engine/SKILL.md` is retained for optional local use, referencing the same Engram MCP tools.

## Architecture

```
+----------------------------------------------------+
|                  Vercel (always-on)                 |
|                                                     |
|  Vercel Cron           Telegram Webhook             |
|  (*/15 * * * *)        POST /api/telegram           |
|       |                       |                     |
|       v                       v                     |
|  +-------------------------------------------+      |
|  |        Life Engine Agent                   |      |
|  |   (OpenAI tool-calling, Vercel AI SDK)     |      |
|  |                                            |      |
|  |   Proactive mode:                          |      |
|  |     time check -> dedup -> decide ->       |      |
|  |     calendar -> enrich -> send -> log      |      |
|  |                                            |      |
|  |   Reactive mode:                           |      |
|  |     understand intent -> act -> reply      |      |
|  +-------------------------------------------+      |
|       |         |          |         |               |
|       v         v          v         v               |
|    Google    Engram     Telegram   Life Engine        |
|    Calendar  Thoughts   Bot       Tables             |
|    API       (pgvector) (grammy)  (Neon)             |
+----------------------------------------------------+

Optional (local Claude Code session):
+--------------------+
| Claude Code        |
| /loop /life-engine | --> Calls Engram MCP tools
| ~/.claude/skills/  |
+--------------------+
```

## Decisions

### Why OpenAI instead of Claude API

- Engram already uses `@ai-sdk/openai` and `ai` (Vercel AI SDK)
- API key and SDK already configured
- No new dependencies
- Model is configurable via env var — can switch to Claude API later by adding `@ai-sdk/anthropic`

### Why Vercel cron instead of dynamic CronCreate/CronDelete

- Always-on — doesn't depend on a local Claude Code session
- Fixed 15-minute interval is simple; the agent's time-window logic handles smart scheduling
- No-op runs are nearly free (one db query to check briefings)
- OB1's dynamic cron solves a problem we don't have (cron expiry) since Vercel crons are persistent

### Why route all Telegram messages through the agent

- The agent can determine intent better than static pattern matching
- It can still capture thoughts (captureThought is one of its tools)
- Enables conversational coaching: habit logs, check-ins, evolution approvals
- Single handler replaces growing if/else chain

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/lib/life-engine-agent.ts` | Core agent — system prompt, tool definitions, OpenAI tool-calling loop |
| `src/app/api/cron/life-engine/route.ts` | Vercel cron endpoint — runs proactive mode |
| `~/.claude/skills/life-engine/SKILL.md` | Updated skill for optional local Claude Code use |

### Modified Files

| File | Change |
|------|--------|
| `src/app/api/telegram/route.ts` | Route non-command messages through agent reactive mode |
| `vercel.json` | Change cron from `0 7 * * *` to `*/15 * * * *`, point to `/api/cron/life-engine` |

### Removed Files

| File | Reason |
|------|--------|
| `src/app/api/cron/briefing/route.ts` | Replaced by life-engine cron (superset of morning briefing) |
| `.claude/skills/life-engine.md` | Replaced by `~/.claude/skills/life-engine/SKILL.md` |

## Agent Design

### Entry Point

```typescript
runLifeEngine(options: {
  mode: "proactive" | "reactive";
  userMessage?: string;
  model?: string; // defaults to env LIFE_ENGINE_MODEL or "gpt-4o"
}): Promise<{ response: string; actions: string[] }>
```

### System Prompt (proactive mode)

Adapted from OB1's life-engine-skill.md. Includes:
- Current date/time and timezone
- The 7-step core loop
- Time window definitions and expected behavior
- Self-improvement protocol (weekly)
- Message format templates
- Rules (no duplicates, concise, silence over noise, respect quiet hours)

### System Prompt (reactive mode)

Includes:
- User context (who they are, their habits, recent briefings)
- Instructions for intent detection
- Tool usage guidance
- Tone: warm, concise, coach-like

### Tools

All tools wrap existing database functions from `life-engine-db.ts`, `db.ts`, `capture.ts`, `calendar.ts`, and `telegram.ts`:

| Agent Tool | Wraps | Used In |
|------------|-------|---------|
| `list_calendar_events` | `listCalendarEvents()` | Proactive |
| `search_thoughts` | `generateEmbedding()` + `searchThoughts()` | Both |
| `capture_thought` | `captureThought()` | Reactive |
| `list_habits` | `listHabits()` | Both |
| `log_habit` | `logHabitCompletion()` | Reactive |
| `get_habit_log` | `getHabitLog()` | Both |
| `submit_checkin` | `insertCheckin()` | Reactive |
| `list_checkins` | `listCheckins()` | Both |
| `list_briefings` | `listBriefings()` | Proactive |
| `log_briefing` | `insertBriefing()` | Proactive |
| `suggest_evolution` | `insertEvolution()` | Proactive |
| `update_evolution` | `updateEvolutionStatus()` | Reactive |
| `send_telegram` | `sendTelegramMessage()` | Proactive only |

In reactive mode, the agent returns text and the Telegram handler sends it via `ctx.reply()`. In proactive mode, the agent calls `send_telegram` directly.

## Time Windows

Same as OB1, adapted for CDT:

| Window | Time | Proactive Action |
|--------|------|-----------------|
| Morning | 6-9 AM | Morning briefing (calendar, habits, context) |
| Pre-Meeting | 15 min before event | Meeting prep (attendees, thought search) |
| Midday | 11 AM-1 PM | Check-in prompt (mood/energy) |
| Afternoon | 1-5 PM | Pre-meeting prep or quiet |
| Evening | 5-8 PM | Day summary (habits, check-ins, tomorrow preview) |
| Quiet Hours | 8 PM-6 AM | No messages (exception: imminent meetings) |

## Self-Improvement Protocol

Every 7 days, during the evening window:
1. Query briefings from the past week
2. Analyze which got responses vs. were ignored
3. Propose ONE change via Telegram
4. Log to `evolution` table as suggested
5. When user replies "yes" or "no", reactive agent updates status

## Model Configuration

```
LIFE_ENGINE_MODEL=gpt-4o          # default, strong reasoning
LIFE_ENGINE_MODEL=gpt-4.1         # cheaper alternative
LIFE_ENGINE_MODEL=gpt-4o-mini     # budget option
LIFE_ENGINE_MODEL=o3              # best reasoning available
```

Single env var in Vercel dashboard. Vercel AI SDK's `openai()` accepts any valid model string.

## Cost Estimate

| Component | Monthly Cost |
|-----------|-------------|
| Vercel functions | ~$0 (well under free/pro limits) |
| OpenAI API (gpt-4o) | ~$2.50/month |
| OpenAI API (best tier) | ~$9/month |
| Neon database | No change |
| Embeddings | ~$0.01/month (already running) |

## Testing Strategy

- Unit tests for agent tool wrappers
- Integration test: proactive mode with mocked time/calendar
- Integration test: reactive mode with sample messages ("finished my run", "feeling tired 3/5", "yes")
- Manual test: trigger cron endpoint, verify Telegram message received
- Manual test: send Telegram messages, verify agent responses

## Migration

1. Deploy new cron endpoint alongside existing briefing cron
2. Test proactive mode manually via curl
3. Test reactive mode by sending Telegram messages
4. Remove old briefing cron and update vercel.json
5. Remove old skill file, install new SKILL.md
