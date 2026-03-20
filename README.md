# Engram

Persistent AI memory layer. One database, every AI tool.

Capture thoughts from anywhere — Telegram, terminal, HTTP, or any MCP client — and retrieve them from anywhere else. Every thought is embedded, classified, and searchable by meaning.

Inspired by [Open Brain (OB1)](https://github.com/NateBJones-Projects/OB1), rebuilt on Vercel + Neon + OpenAI.

## What It Does

- **Capture** from any channel — thoughts are auto-embedded and classified by type, topics, people, action items, and dates
- **Search by meaning** — "upcoming deadlines" finds thoughts about due dates, even if the word "deadline" was never used
- **Cross-client memory** — capture from Telegram on your phone, retrieve from ChatGPT on your laptop
- **Google Calendar** — say "add to my calendar" to create events automatically, color-coded by family member
- **Life Engine** — proactive briefings, habit tracking, mood/energy check-ins, and self-improvement via Telegram
- **7 thought types** — observation, task, idea, reference, person_note, decision, meeting_note

## Architecture

```
Telegram (phone)  ──→  Vercel Function  ──→  Neon Postgres (pgvector)
CLI (terminal)    ──→  /api/capture     ──→    thoughts table
MCP clients       ──→  /api/mcp         ──→    match_thoughts()
                           ↓
                     Vercel AI SDK  ──→  OpenAI API
                     (embed + extract)   (text-embedding-3-small + gpt-4o-mini)
                           ↓
                     "add to my calendar"  ──→  Google Calendar API
                     (trigger phrase)           (color-coded events)

Claude Code skill  ──→  MCP tools  ──→  Life Engine tables
Vercel Cron (7AM)  ──→  /api/cron  ──→  (habits, checkins, briefings, evolution)
                           ↓
                     Proactive Telegram  ←──  briefings + calendar + habits
```

**3 services.** Monthly cost: ~$0.10–0.30 (API calls only, infrastructure on free tiers).

## Quick Start

```bash
git clone https://github.com/geoff-price/engram.git
cd engram
npm install
```

Create `.env.local` from the template:

```bash
cp .env.example .env.local
```

| Variable | Source |
|----------|--------|
| `DATABASE_URL` | [Neon](https://neon.tech) dashboard |
| `OPENAI_API_KEY` | [OpenAI](https://platform.openai.com/api-keys) |
| `ENGRAM_ACCESS_KEY` | `npm run generate-key` |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) (optional) |
| `TELEGRAM_WEBHOOK_SECRET` | Any alphanumeric string (optional) |
| `APP_URL` | Your Vercel URL (after deploy) |
| `GOOGLE_CLIENT_ID` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (optional) |
| `GOOGLE_CLIENT_SECRET` | Same as above (optional) |
| `GOOGLE_REFRESH_TOKEN` | `npm run google-auth` (optional) |
| `CALENDAR_TIMEZONE` | e.g. `America/New_York` (optional) |
| `CALENDAR_FAMILY_COLORS` | `name:colorId` pairs — see below (optional) |
| `CALENDAR_DEFAULT_MEMBER` | Default name for color mapping (optional) |
| `TELEGRAM_CHAT_ID` | From `/start` command — enables proactive messaging (optional) |
| `CRON_SECRET` | Vercel cron auth secret (optional) |

Run migrations and deploy:

```bash
source .env.local && npm run migrate
npx vercel --prod
```

Verify:

```bash
curl https://your-project.vercel.app/api/health
```

## MCP Tools

Any MCP-compatible client (ChatGPT, Claude Desktop, Claude Code, Cursor) can use these tools:

| Tool | Description | Key Params |
|------|-------------|------------|
| `capture_thought` | Save a thought (auto-embeds + classifies) | `content` |
| `search_thoughts` | Semantic search by meaning | `query`, `threshold?`, `limit?`, `type?`, `topic?` |
| `list_thoughts` | Browse recent thoughts | `limit?`, `type?`, `topic?`, `since?` |
| `manage_habit` | Create, update, or deactivate a habit | `action`, `name?`, `frequency?`, `habit_id?` |
| `log_habit` | Log completion of a habit | `habit_id`, `notes?` |
| `list_habits` | List tracked habits | `active_only?` |
| `get_habit_log` | View habit completion history | `habit_id?`, `since?`, `limit?` |
| `submit_checkin` | Log mood/energy check-in | `mood` (1-5), `energy` (1-5), `notes?` |
| `list_checkins` | View check-in history | `limit?`, `since?` |
| `log_briefing` | Record a sent briefing | `type`, `content` |
| `list_briefings` | View briefing history | `limit?`, `type?` |
| `suggest_evolution` | Suggest a self-improvement | `change_type`, `description` |
| `update_evolution` | Approve/reject/apply suggestion | `evolution_id`, `status` |
| `list_calendar_events` | List Google Calendar events | `start_date?`, `end_date?` |
| `send_message` | Send proactive Telegram message | `text` |

## Connect Clients

**ChatGPT** (Settings → Apps & Connectors → Add MCP):

```
https://your-project.vercel.app/api/mcp?key=YOUR_ACCESS_KEY
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-project.vercel.app/api/mcp?key=YOUR_ACCESS_KEY"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add --transport http engram \
  https://your-project.vercel.app/api/mcp \
  --header "x-engram-key: YOUR_ACCESS_KEY"
```

**Telegram** (optional):

```bash
# After setting TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in Vercel
npm run set-telegram-webhook
```

Send any message to your bot — it captures and classifies automatically. Use `/search <query>` to find thoughts. Include "add to my calendar" to create Google Calendar events.

**CLI** (add to `~/.bashrc` or `~/.zshrc`):

```bash
engram() {
  curl -s -X POST "https://your-project.vercel.app/api/capture" \
    -H "Content-Type: application/json" \
    -H "x-engram-key: YOUR_ACCESS_KEY" \
    -d "{\"content\": \"$*\", \"source\": \"cli\"}"
}
```

Then: `engram "Book the Lake Tahoe cabin before June — ask Sarah about group size"`

## Google Calendar (Optional)

Create events from any capture channel by including a trigger phrase like "add to my calendar."

**Setup:**

1. Create OAuth credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (Desktop app type)
2. Enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
3. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env.local`
4. Run the one-time auth flow:

```bash
source .env.local && npm run google-auth
```

5. Copy the printed `GOOGLE_REFRESH_TOKEN` into `.env.local`
6. Configure family color mapping:

```bash
# Google Calendar color IDs: 1=lavender, 2=sage, 3=grape, 4=flamingo, 5=banana,
#   6=tangerine, 7=peacock, 8=graphite, 9=blueberry, 10=basil, 11=tomato
CALENDAR_FAMILY_COLORS=member1:6,member2:4,family:9
CALENDAR_DEFAULT_MEMBER=member1
CALENDAR_TIMEZONE=America/New_York
```

**Usage:**

```
Add to my calendar: Jonah's soccer game Saturday 10am at City Park
```

Events are color-coded by family member. When multiple members are mentioned, the "family" color is used. When no member is mentioned, the default member's color is used.

Multiple events in a single message are supported — paste a schedule and each event is created separately.

See [`docs/google-calendar.md`](docs/google-calendar.md) for the full feature spec.

## Life Engine (Optional)

Proactive personal assistant that sends Telegram briefings, tracks habits, logs mood/energy, and suggests its own improvements.

**Setup:**

1. Run the Life Engine migration:
   ```bash
   source .env.local && npm run migrate
   ```

2. Send `/start` to your Engram Telegram bot — it will show your chat ID.

3. Add to your environment:
   ```bash
   TELEGRAM_CHAT_ID=123456789
   CRON_SECRET=your-secret-here
   ```

4. Deploy to Vercel. The morning cron job (7 AM daily) auto-registers from `vercel.json`.

5. Run the Claude Code skill for full functionality:
   ```bash
   claude "/loop 15m /life-engine"
   ```

The skill checks your calendar, surfaces relevant thoughts before meetings, prompts for habit check-ins, and sends morning/midday/evening briefings. Weekly reviews analyze trends and suggest improvements.

See [`docs/life-engine.md`](docs/life-engine.md) for the full feature spec.

## Running Tests

```bash
npm test
```

Unit tests covering auth (key extraction, timing-safe validation), rate limiting (sliding window, expiration), metadata schemas (Zod validation, defaults, constraints), and calendar integration (trigger detection, color resolution, schema validation).

## Security

- **Auth** — timing-safe key comparison on all read/write endpoints
- **Rate limiting** — 30 captures per minute (prevents runaway AI agent loops)
- **Input cap** — 10KB max per thought
- **Telegram** — webhook secret required, rejects when not configured
- **Key sources** — `x-engram-key` header, `Authorization: Bearer`, or `?key=` query param

## Stack

| Component | Service | Tier |
|-----------|---------|------|
| Runtime | Vercel (Next.js App Router) | Free |
| Database | Neon Postgres (pgvector) | Free |
| Embeddings | OpenAI `text-embedding-3-small` | Pay-per-use |
| Classification | OpenAI `gpt-4o-mini` | Pay-per-use |
| MCP transport | Streamable HTTP (2025-03-26 spec) | — |
| Telegram | grammY | — |
| Calendar | Google Calendar API | Free |

## OB1 Recipe

The [`recipe/vercel-neon-telegram`](recipe/vercel-neon-telegram) directory contains a genericized version of this project, packaged for contribution to [OB1](https://github.com/NateBJones-Projects/OB1) as an alternative architecture recipe. The recipe uses generic naming (`BRAIN_ACCESS_KEY`, `x-brain-key`, "open-brain") and includes its own README, tests, and metadata.

## License

MIT
