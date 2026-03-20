# Life Engine

A proactive personal assistant layer for Engram. Checks your calendar, tracks habits, logs mood/energy, sends Telegram briefings, and suggests its own improvements.

Adapted from the [OB1 Life Engine recipe](https://github.com/NateBJones-Projects/OB1/tree/main/recipes/life-engine) for Engram's Vercel + Neon + grammY stack.

## How It Works

Two execution paths, same data:

1. **Claude Code skill** (primary) — run `claude "/loop 15m /life-engine"` for continuous monitoring. Uses full Claude reasoning at zero API cost.
2. **Vercel Cron** (fallback) — sends a morning briefing at 7 AM daily via `gpt-4o-mini`, even when Claude Code isn't running. Cost: ~$0.001/day.

## Database Tables

5 new tables added by `sql/003-life-engine.sql`:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `habits` | What to track | name, frequency, time_of_day, active |
| `habit_log` | Completion records | habit_id (FK), notes, completed_at |
| `checkins` | Mood/energy snapshots | mood (1-5), energy (1-5), notes |
| `briefings` | Sent briefing log | type, content, sent_via, sent_at |
| `evolution` | Self-improvement suggestions | change_type, description, status |

## MCP Tools

12 new tools available through the Engram MCP server:

| Tool | Description |
|------|-------------|
| `manage_habit` | Create, update, or deactivate a habit |
| `log_habit` | Log completion of a habit |
| `list_habits` | List tracked habits |
| `get_habit_log` | View habit completion history |
| `submit_checkin` | Log mood/energy check-in (1-5) |
| `list_checkins` | View check-in history |
| `log_briefing` | Record a sent briefing (dedup) |
| `list_briefings` | View briefing history |
| `suggest_evolution` | Suggest a self-improvement |
| `update_evolution` | Approve/reject/apply a suggestion |
| `list_calendar_events` | List Google Calendar events |
| `send_message` | Send proactive Telegram message |

## Time Windows

The Life Engine skill operates on a schedule:

| Window | Time | Action |
|--------|------|--------|
| Morning | 6–9 AM | Calendar overview, habit reminders, relevant thoughts |
| Pre-meeting | 15 min before | Attendee/topic context from memory |
| Midday | 12–1 PM | Habit progress, mood/energy prompt |
| Evening | 8–10 PM | Day summary, habit completion, reflections |
| Quiet hours | 10 PM – 6 AM | No messages |
| Weekly | Sunday evening | Trend analysis, evolution suggestions |

## Setup

1. Run the migration:
   ```bash
   source .env.local && npm run migrate
   ```

2. Get your Telegram chat ID:
   - Send `/start` to your Engram bot
   - Copy the chat ID from the response

3. Add to your environment:
   ```bash
   TELEGRAM_CHAT_ID=123456789
   CRON_SECRET=your-secret-here
   ```

4. Deploy to Vercel (cron auto-registers from `vercel.json`).

5. Run the skill:
   ```bash
   claude "/loop 15m /life-engine"
   ```

## Self-Improvement Protocol

The Life Engine can suggest changes to itself via the `evolution` table:

1. **Suggest** — the skill proposes a change (prompt tweak, new habit category, briefing format)
2. **Review** — user approves or rejects via `update_evolution`
3. **Apply** — approved changes are incorporated into future behavior

Weekly reviews on Sundays analyze patterns in briefings, check-ins, and habits to generate suggestions.

## Habit Frequencies

| Frequency | Meaning |
|-----------|---------|
| `daily` | Every day |
| `weekly` | Once per week |
| `weekdays` | Monday through Friday |
| `specific_days` | Custom (stored in time_of_day) |
