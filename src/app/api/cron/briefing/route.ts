import { getLatestBriefing, insertBriefing, listHabits } from "@/lib/life-engine-db";
import { listCalendarEvents, getTimezone } from "@/lib/calendar";
import { listThoughts } from "@/lib/db";
import { sendTelegramMessage, isTelegramSendConfigured } from "@/lib/telegram";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export const maxDuration = 30;

export async function GET(req: Request) {
  // Verify Vercel cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isTelegramSendConfigured()) {
    return Response.json({ error: "Telegram not configured for proactive messaging" }, { status: 503 });
  }

  // Check if morning briefing already sent today
  const latest = await getLatestBriefing("morning");
  if (latest) {
    const timezone = getTimezone();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
    const sentDate = new Date(latest.sent_at).toLocaleDateString("en-CA", { timeZone: timezone });
    if (sentDate === today) {
      return Response.json({ status: "skipped", reason: "Morning briefing already sent today" });
    }
  }

  const timezone = getTimezone();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });

  // Gather context in parallel
  const [events, habits, thoughts] = await Promise.all([
    listCalendarEvents(today, today).catch(() => []),
    listHabits(true).catch(() => []),
    listThoughts({ since: `${today}T00:00:00`, limit: 10 }).catch(() => []),
  ]);

  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: z.object({ briefing: z.string() }),
    prompt: `Compose a concise morning briefing for ${today}. Keep it under 500 characters. Use plain text (no markdown).

Calendar events today:
${events.length > 0 ? events.map((e) => `• ${e.title} — ${e.all_day ? "All day" : `${e.start} → ${e.end}`}${e.location ? ` (${e.location})` : ""}`).join("\n") : "No events scheduled."}

Active habits to track:
${habits.length > 0 ? habits.map((h) => `• ${h.name} (${h.frequency})`).join("\n") : "No habits configured."}

Recent thoughts:
${thoughts.length > 0 ? thoughts.map((t) => `• ${t.content.slice(0, 100)}`).join("\n") : "No recent thoughts."}

Format: Start with a greeting, summarize the day ahead, remind about habits. Be warm but brief.`,
  });

  await sendTelegramMessage(object.briefing);
  await insertBriefing("morning", object.briefing, "cron");

  return Response.json({ status: "sent", briefing: object.briefing });
}
