import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkRateLimit } from "./rate-limit";
import {
  habitFrequencyEnum,
  briefingTypeEnum,
  evolutionStatusEnum,
} from "./types";
import {
  insertHabit,
  listHabits,
  updateHabit,
  deactivateHabit,
  logHabitCompletion,
  getHabitLog,
  insertCheckin,
  listCheckins,
  insertBriefing,
  getLatestBriefing,
  listBriefings,
  insertEvolution,
  updateEvolutionStatus,
  listEvolutions,
} from "./life-engine-db";
import { listCalendarEvents, isCalendarConfigured, getTimezone } from "./calendar";
import { sendTelegramMessage, isTelegramSendConfigured } from "./telegram";

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

export function registerLifeEngineTools(server: McpServer) {
  // --- Habits ---

  server.tool(
    "manage_habit",
    "Create, update, or deactivate a habit to track.",
    {
      action: z.enum(["create", "update", "deactivate"]),
      name: z.string().optional().describe("Habit name (required for create)"),
      frequency: habitFrequencyEnum.optional().describe("How often: daily, weekly, weekdays, specific_days"),
      time_of_day: z.string().optional().describe("Preferred time, e.g. 'morning', '7am'"),
      habit_id: z.string().optional().describe("Required for update/deactivate"),
    },
    async ({ action, name, frequency, time_of_day, habit_id }) => {
      if (action === "create") {
        if (!name || !frequency) return text("Name and frequency are required to create a habit.");
        const id = await insertHabit(name, frequency, time_of_day);
        return text(`Habit created: "${name}" (${frequency}). ID: ${id}`);
      }
      if (action === "update") {
        if (!habit_id) return text("habit_id is required for update.");
        await updateHabit(habit_id, { name, frequency, time_of_day });
        return text(`Habit ${habit_id} updated.`);
      }
      if (action === "deactivate") {
        if (!habit_id) return text("habit_id is required for deactivate.");
        await deactivateHabit(habit_id);
        return text(`Habit ${habit_id} deactivated.`);
      }
      return text("Unknown action.");
    },
  );

  server.tool(
    "log_habit",
    "Log completion of a habit.",
    {
      habit_id: z.string().describe("The habit to log"),
      notes: z.string().optional().describe("Optional notes about this completion"),
    },
    async ({ habit_id, notes }) => {
      const id = await logHabitCompletion(habit_id, notes);
      return text(`Habit completion logged. Log ID: ${id}`);
    },
  );

  server.tool(
    "list_habits",
    "List tracked habits.",
    {
      active_only: z.boolean().optional().describe("Only show active habits (default true)"),
    },
    async ({ active_only }) => {
      const habits = await listHabits(active_only ?? true);
      if (habits.length === 0) return text("No habits found.");
      const lines = habits.map(
        (h) => `• ${h.name} (${h.frequency}${h.time_of_day ? `, ${h.time_of_day}` : ""}) [${h.active ? "active" : "inactive"}] — ${h.id}`,
      );
      return text(lines.join("\n"));
    },
  );

  server.tool(
    "get_habit_log",
    "View habit completion history.",
    {
      habit_id: z.string().optional().describe("Filter to a specific habit"),
      since: z.string().optional().describe("ISO date — only entries after this"),
      limit: z.number().min(1).max(100).optional().describe("Max results (default 50)"),
    },
    async ({ habit_id, since, limit }) => {
      const entries = await getHabitLog({ habitId: habit_id, since, limit });
      if (entries.length === 0) return text("No habit log entries found.");
      const lines = entries.map(
        (e) => `${e.completed_at} — habit ${e.habit_id}${e.notes ? `: ${e.notes}` : ""}`,
      );
      return text(lines.join("\n"));
    },
  );

  // --- Checkins ---

  server.tool(
    "submit_checkin",
    "Log a mood/energy check-in (1-5 scale).",
    {
      mood: z.number().int().min(1).max(5).describe("Mood rating 1-5"),
      energy: z.number().int().min(1).max(5).describe("Energy rating 1-5"),
      notes: z.string().optional().describe("Optional notes"),
    },
    async ({ mood, energy, notes }) => {
      const id = await insertCheckin(mood, energy, notes);
      return text(`Check-in recorded. Mood: ${mood}/5, Energy: ${energy}/5. ID: ${id}`);
    },
  );

  server.tool(
    "list_checkins",
    "View recent mood/energy check-ins.",
    {
      limit: z.number().min(1).max(50).optional().describe("Max results (default 20)"),
      since: z.string().optional().describe("ISO date — only entries after this"),
    },
    async ({ limit, since }) => {
      const checkins = await listCheckins({ limit, since });
      if (checkins.length === 0) return text("No check-ins found.");
      const lines = checkins.map(
        (c) => `${c.created_at} — Mood: ${c.mood}/5, Energy: ${c.energy}/5${c.notes ? ` — ${c.notes}` : ""}`,
      );
      return text(lines.join("\n"));
    },
  );

  // --- Briefings ---

  server.tool(
    "log_briefing",
    "Record that a briefing was sent (for dedup tracking).",
    {
      type: briefingTypeEnum.describe("Briefing type: morning, pre_meeting, midday, evening"),
      content: z.string().describe("The briefing content that was sent"),
    },
    async ({ type, content }) => {
      const id = await insertBriefing(type, content);
      return text(`Briefing logged (${type}). ID: ${id}`);
    },
  );

  server.tool(
    "list_briefings",
    "View briefing history.",
    {
      limit: z.number().min(1).max(50).optional().describe("Max results (default 20)"),
      type: briefingTypeEnum.optional().describe("Filter by briefing type"),
    },
    async ({ limit, type }) => {
      const briefings = await listBriefings({ limit, type });
      if (briefings.length === 0) return text("No briefings found.");
      const lines = briefings.map(
        (b) => `${b.sent_at} [${b.type}] via ${b.sent_via}\n  ${b.content.slice(0, 200)}${b.content.length > 200 ? "…" : ""}`,
      );
      return text(lines.join("\n\n"));
    },
  );

  // --- Evolution ---

  server.tool(
    "suggest_evolution",
    "Suggest a self-improvement change for the Life Engine.",
    {
      change_type: z.string().describe("Category of change (e.g. 'prompt', 'habit', 'briefing_format')"),
      description: z.string().describe("What to change and why"),
    },
    async ({ change_type, description }) => {
      const id = await insertEvolution(change_type, description);
      return text(`Evolution suggested. ID: ${id}\nAwaiting approval.`);
    },
  );

  server.tool(
    "update_evolution",
    "Approve, reject, or mark an evolution suggestion as applied.",
    {
      evolution_id: z.string().describe("The evolution to update"),
      status: z.enum(["approved", "rejected", "applied"]).describe("New status"),
    },
    async ({ evolution_id, status }) => {
      await updateEvolutionStatus(evolution_id, status);
      return text(`Evolution ${evolution_id} → ${status}.`);
    },
  );

  // --- Calendar ---

  server.tool(
    "list_calendar_events",
    "List upcoming Google Calendar events.",
    {
      start_date: z.string().optional().describe("Start date (YYYY-MM-DD, default today)"),
      end_date: z.string().optional().describe("End date (YYYY-MM-DD, default same as start)"),
    },
    async ({ start_date, end_date }) => {
      if (!isCalendarConfigured()) return text("Google Calendar is not configured.");
      const timezone = getTimezone();
      const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
      const start = start_date || today;
      const end = end_date || start;
      const events = await listCalendarEvents(start, end);
      if (events.length === 0) return text(`No events found for ${start}${end !== start ? ` to ${end}` : ""}.`);
      const lines = events.map((e) => {
        const time = e.all_day ? "All day" : `${e.start} → ${e.end}`;
        return `• ${e.title} — ${time}${e.location ? ` (${e.location})` : ""}`;
      });
      return text(lines.join("\n"));
    },
  );

  // --- Proactive Messaging ---

  server.tool(
    "send_message",
    "Send a proactive Telegram message.",
    {
      text: z.string().describe("Message text to send"),
    },
    async ({ text: messageText }) => {
      const rl = checkRateLimit();
      if (!rl.ok) return text("Rate limit exceeded. Try again in a minute.");
      if (!isTelegramSendConfigured()) return text("Proactive Telegram not configured. Set TELEGRAM_CHAT_ID.");
      await sendTelegramMessage(messageText);
      return text("Message sent via Telegram.");
    },
  );
}
