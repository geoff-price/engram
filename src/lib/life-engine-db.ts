import { neon } from "@neondatabase/serverless";
import type {
  Habit,
  HabitLogEntry,
  Checkin,
  Briefing,
  Evolution,
  HabitFrequency,
  BriefingType,
  EvolutionStatus,
} from "./types";

function getSQL() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return neon(url);
}

// --- Habits ---

export async function insertHabit(
  name: string,
  frequency: HabitFrequency,
  timeOfDay?: string,
): Promise<string> {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO habits (name, frequency, time_of_day)
    VALUES (${name}, ${frequency}, ${timeOfDay ?? null})
    RETURNING id
  `;
  return rows[0].id;
}

export async function listHabits(activeOnly = true): Promise<Habit[]> {
  const sql = getSQL();
  if (activeOnly) {
    const rows = await sql`
      SELECT * FROM habits WHERE active = true ORDER BY created_at
    `;
    return rows as unknown as Habit[];
  }
  const rows = await sql`SELECT * FROM habits ORDER BY created_at`;
  return rows as unknown as Habit[];
}

export async function updateHabit(
  id: string,
  fields: Partial<Pick<Habit, "name" | "frequency" | "time_of_day" | "active">>,
): Promise<void> {
  const sql = getSQL();
  const sets: string[] = [];
  const params: (string | boolean | null)[] = [];
  let idx = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    params.push(fields.name);
  }
  if (fields.frequency !== undefined) {
    sets.push(`frequency = $${idx++}`);
    params.push(fields.frequency);
  }
  if (fields.time_of_day !== undefined) {
    sets.push(`time_of_day = $${idx++}`);
    params.push(fields.time_of_day);
  }
  if (fields.active !== undefined) {
    sets.push(`active = $${idx++}`);
    params.push(fields.active);
  }

  if (sets.length === 0) return;

  params.push(id);
  const query = `UPDATE habits SET ${sets.join(", ")} WHERE id = $${idx}`;
  await sql.query(query, params);
}

export async function deactivateHabit(id: string): Promise<void> {
  const sql = getSQL();
  await sql`UPDATE habits SET active = false WHERE id = ${id}`;
}

export async function logHabitCompletion(
  habitId: string,
  notes?: string,
): Promise<string> {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO habit_log (habit_id, notes)
    VALUES (${habitId}, ${notes ?? null})
    RETURNING id
  `;
  return rows[0].id;
}

export async function getHabitLog(options: {
  habitId?: string;
  since?: string;
  limit?: number;
} = {}): Promise<HabitLogEntry[]> {
  const sql = getSQL();
  const { habitId, since, limit = 50 } = options;

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let idx = 1;

  if (habitId) {
    conditions.push(`habit_id = $${idx++}`);
    params.push(habitId);
  }
  if (since) {
    conditions.push(`completed_at >= $${idx++}::timestamptz`);
    params.push(since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const query = `
    SELECT * FROM habit_log ${where}
    ORDER BY completed_at DESC
    LIMIT $${idx}
  `;
  const rows = await sql.query(query, params);
  return rows as unknown as HabitLogEntry[];
}

// --- Checkins ---

export async function insertCheckin(
  mood: number,
  energy: number,
  notes?: string,
): Promise<string> {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO checkins (mood, energy, notes)
    VALUES (${mood}, ${energy}, ${notes ?? null})
    RETURNING id
  `;
  return rows[0].id;
}

export async function listCheckins(options: {
  limit?: number;
  since?: string;
} = {}): Promise<Checkin[]> {
  const sql = getSQL();
  const { limit = 20, since } = options;

  if (since) {
    const rows = await sql`
      SELECT * FROM checkins
      WHERE created_at >= ${since}::timestamptz
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows as unknown as Checkin[];
  }

  const rows = await sql`
    SELECT * FROM checkins ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows as unknown as Checkin[];
}

// --- Briefings ---

export async function insertBriefing(
  type: BriefingType,
  content: string,
  sentVia = "telegram",
): Promise<string> {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO briefings (type, content, sent_via)
    VALUES (${type}, ${content}, ${sentVia})
    RETURNING id
  `;
  return rows[0].id;
}

export async function getLatestBriefing(
  type: BriefingType,
): Promise<Briefing | null> {
  const sql = getSQL();
  const rows = await sql`
    SELECT * FROM briefings
    WHERE type = ${type}
    ORDER BY sent_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as Briefing;
}

export async function listBriefings(options: {
  limit?: number;
  type?: BriefingType;
} = {}): Promise<Briefing[]> {
  const sql = getSQL();
  const { limit = 20, type } = options;

  if (type) {
    const rows = await sql`
      SELECT * FROM briefings
      WHERE type = ${type}
      ORDER BY sent_at DESC
      LIMIT ${limit}
    `;
    return rows as unknown as Briefing[];
  }

  const rows = await sql`
    SELECT * FROM briefings ORDER BY sent_at DESC LIMIT ${limit}
  `;
  return rows as unknown as Briefing[];
}

// --- Evolution ---

export async function insertEvolution(
  changeType: string,
  description: string,
): Promise<string> {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO evolution (change_type, description)
    VALUES (${changeType}, ${description})
    RETURNING id
  `;
  return rows[0].id;
}

export async function updateEvolutionStatus(
  id: string,
  status: EvolutionStatus,
): Promise<void> {
  const sql = getSQL();
  if (status === "applied") {
    await sql`
      UPDATE evolution SET status = ${status}, applied_at = now() WHERE id = ${id}
    `;
  } else {
    await sql`UPDATE evolution SET status = ${status} WHERE id = ${id}`;
  }
}

export async function listEvolutions(
  status?: EvolutionStatus,
): Promise<Evolution[]> {
  const sql = getSQL();
  if (status) {
    const rows = await sql`
      SELECT * FROM evolution WHERE status = ${status} ORDER BY created_at DESC
    `;
    return rows as unknown as Evolution[];
  }
  const rows = await sql`SELECT * FROM evolution ORDER BY created_at DESC`;
  return rows as unknown as Evolution[];
}

// --- Telegram Conversation History ---

export async function saveTelegramMessage(
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const sql = getSQL();
  await sql`
    INSERT INTO telegram_messages (role, content)
    VALUES (${role}, ${content})
  `;
}

export async function getRecentTelegramMessages(
  limit = 10,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const sql = getSQL();
  const rows = await sql`
    SELECT role, content FROM telegram_messages
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  // Reverse so oldest first (chronological order)
  return (rows as unknown as { role: "user" | "assistant"; content: string }[]).reverse();
}
