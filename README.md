# Engram

Persistent AI memory layer. One database, every AI tool.

Capture thoughts from anywhere — Telegram, terminal, HTTP, or any MCP client — and retrieve them from anywhere else. Every thought is embedded, classified, and searchable by meaning.

Inspired by [Open Brain (OB1)](https://github.com/NateBJones-Projects/OB1), rebuilt on Vercel + Neon + OpenAI.

## What It Does

- **Capture** from any channel — thoughts are auto-embedded and classified by type, topics, people, action items, and dates
- **Search by meaning** — "upcoming deadlines" finds thoughts about due dates, even if the word "deadline" was never used
- **Cross-client memory** — capture from Telegram on your phone, retrieve from ChatGPT on your laptop
- **7 thought types** — observation, task, idea, reference, person_note, decision, meeting_note

## Architecture

```
Telegram (phone)  ──→  Vercel Function  ──→  Neon Postgres (pgvector)
CLI (terminal)    ──→  /api/capture     ──→    thoughts table
MCP clients       ──→  /api/mcp         ──→    match_thoughts()
                           ↓
                     Vercel AI SDK  ──→  OpenAI API
                     (embed + extract)   (text-embedding-3-small + gpt-4o-mini)
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

Send any message to your bot — it captures and classifies automatically. Use `/search <query>` to find thoughts.

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

## Running Tests

```bash
npm test
```

30 unit tests covering auth (key extraction, timing-safe validation), rate limiting (sliding window, expiration), and metadata schemas (Zod validation, defaults, constraints).

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

## OB1 Recipe

The [`recipe/vercel-neon-telegram`](recipe/vercel-neon-telegram) directory contains a genericized version of this project, packaged for contribution to [OB1](https://github.com/NateBJones-Projects/OB1) as an alternative architecture recipe. The recipe uses generic naming (`BRAIN_ACCESS_KEY`, `x-brain-key`, "open-brain") and includes its own README, tests, and metadata.

## License

MIT
