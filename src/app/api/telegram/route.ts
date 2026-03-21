export const maxDuration = 30;

import { Bot, webhookCallback } from "grammy";
import { neon } from "@neondatabase/serverless";
import { captureThought } from "@/lib/capture";
import { searchThoughts } from "@/lib/db";
import { generateEmbedding } from "@/lib/ai";
import { getTimezone } from "@/lib/calendar";
import type { CalendarEventResult } from "@/lib/types";

function formatCalendarReceipt(results: CalendarEventResult[]): string {
  const timezone = getTimezone();
  const created = results.filter((e) => e.status === "created");
  const failed = results.filter((e) => e.status === "failed");
  let text = "";

  if (created.length > 0) {
    text += "\n\n✅ Added to Google Calendar:";
    for (const event of created) {
      const start = new Date(event.start);
      const dateStr = start.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: timezone,
      });
      const timeStr = start.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
      });
      text += `\n• ${event.title} — ${dateStr} @ ${timeStr}`;
      if (event.location) text += `\n  📍 ${event.location}`;
    }
  }

  if (failed.length > 0) {
    const capWarning = failed.find((e) => e.title.startsWith("⚠️"));
    if (capWarning) {
      text += `\n\n${capWarning.title}\n${capWarning.error}`;
    }
    const realFails = failed.filter((e) => !e.title.startsWith("⚠️"));
    if (realFails.length > 0) {
      text += `\n\n⚠️ ${realFails.length} event${realFails.length > 1 ? "s" : ""} failed to add to calendar`;
    }
  }

  return text;
}

function createBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

  const bot = new Bot(token);

  bot.command("start", (ctx) => {
    const chatId = ctx.chat.id;
    return ctx.reply(
      `🧠 Engram connected.\n\nSend me any thought, note, or idea — I'll classify and store it.\n\nSay "add to my calendar" to create Google Calendar events.\n\nCommands:\n/search <query> — find related thoughts\n/start — show this message\n\nYour chat ID: ${chatId}\n→ Add TELEGRAM_CHAT_ID=${chatId} to your environment variables to enable proactive briefings.`,
    );
  });

  bot.command("search", async (ctx) => {
    const query = ctx.match;
    if (!query) {
      return ctx.reply("Usage: /search <query>");
    }

    const queryEmbedding = await generateEmbedding(query);
    const results = await searchThoughts(queryEmbedding, { limit: 5 });

    if (results.length === 0) {
      return ctx.reply("No matching thoughts found.");
    }

    const text = results
      .map(
        (t, i) =>
          `${i + 1}. [${t.metadata.type}] ${t.content.slice(0, 200)}${t.content.length > 200 ? "…" : ""}\n   (${Math.round((t.similarity ?? 0) * 100)}% match)`,
      )
      .join("\n\n");

    return ctx.reply(text);
  });

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

  // Capture photo captions
  bot.on("message:photo", async (ctx) => {
    const caption = ctx.message.caption;
    if (!caption) {
      return ctx.reply("Send a caption with the photo to capture a thought.");
    }

    const result = await captureThought(caption, "telegram");
    let reply = `✓ Captured caption as ${result.metadata.type}`;

    if (result.calendarResults?.length) {
      reply += formatCalendarReceipt(result.calendarResults);
    }

    await ctx.reply(reply);
  });

  return bot;
}

// Cache bot instance for the module lifetime
let bot: Bot | undefined;
function getBot(): Bot {
  if (!bot) bot = createBot();
  return bot;
}

// Database-level dedup: survives serverless cold starts
async function isDuplicate(messageId: number): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false; // If no DB, fall through (shouldn't happen in prod)
  const sql = neon(url);
  // INSERT ... ON CONFLICT DO NOTHING returns 0 rows if already exists
  const rows = await sql`
    INSERT INTO processed_messages (message_id)
    VALUES (${messageId})
    ON CONFLICT (message_id) DO NOTHING
    RETURNING message_id
  `;
  // If the insert returned a row, this is a NEW message (not a duplicate)
  // If it returned nothing, the message_id already existed (duplicate)
  return rows.length === 0;
}

export async function POST(req: Request) {
  // Validate Telegram webhook secret — reject if not configured or mismatched
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return Response.json({ error: "Telegram webhook not configured" }, { status: 503 });
  }
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== expectedSecret) {
    return Response.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  // Check for duplicate webhook delivery (Telegram retries on timeout)
  // Uses database-level dedup — survives serverless cold starts
  const body = await req.json();
  const messageId = body?.message?.message_id ?? body?.edited_message?.message_id;
  if (messageId && await isDuplicate(messageId)) {
    return Response.json({ ok: true, dedup: true });
  }

  const handler = webhookCallback(getBot(), "std/http", {
    timeoutMilliseconds: 25_000,
  });
  // Reconstruct request with already-parsed body
  const newReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(body),
  });
  return handler(newReq);
}
