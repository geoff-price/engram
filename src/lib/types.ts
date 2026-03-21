import { z } from "zod";

export const thoughtTypeEnum = z.enum([
  "observation",
  "task",
  "idea",
  "reference",
  "person_note",
  "decision",
  "meeting_note",
]);

export type ThoughtType = z.infer<typeof thoughtTypeEnum>;

export const metadataSchema = z.object({
  people: z.array(z.string()).default([]),
  action_items: z.array(z.string()).default([]),
  dates_mentioned: z.array(z.string()).default([]),
  topics: z.array(z.string()).max(3).default([]),
  type: thoughtTypeEnum.default("observation"),
});

export type ThoughtMetadata = z.infer<typeof metadataSchema>;

// Calendar event extraction schema (LLM output)
export const calendarExtractionSchema = z.object({
  events: z.array(
    z.object({
      title: z.string().describe("Short event title, 5 words max"),
      start_datetime: z.string(),
      end_datetime: z.string(),
      location: z.string().optional(),
      person: z.string().optional(),
      description: z.string().describe("All additional details, notes, requirements, and context from the original text that don't fit in the title. Always populate this if there is any extra information."),
    }),
  ),
});

export type CalendarExtraction = z.infer<typeof calendarExtractionSchema>;

// Calendar event result (after Google Calendar API call)
export interface CalendarEventResult {
  title: string;
  start: string;
  end: string;
  location?: string;
  person?: string;
  color_id?: string;
  event_id?: string;
  status: "created" | "failed";
  error?: string;
}

export interface Thought {
  id: string;
  content: string;
  metadata: ThoughtMetadata;
  similarity?: number;
  source: string;
  created_at: string;
}

// --- Life Engine types ---

export const habitFrequencyEnum = z.enum([
  "daily",
  "weekly",
  "weekdays",
  "specific_days",
]);
export type HabitFrequency = z.infer<typeof habitFrequencyEnum>;

export const briefingTypeEnum = z.enum([
  "morning",
  "pre_meeting",
  "midday",
  "evening",
]);
export type BriefingType = z.infer<typeof briefingTypeEnum>;

export const evolutionStatusEnum = z.enum([
  "suggested",
  "approved",
  "rejected",
  "applied",
]);
export type EvolutionStatus = z.infer<typeof evolutionStatusEnum>;

export const checkinSchema = z.object({
  mood: z.number().int().min(1).max(5),
  energy: z.number().int().min(1).max(5),
  notes: z.string().optional(),
});

export interface Habit {
  id: string;
  name: string;
  frequency: HabitFrequency;
  time_of_day: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HabitLogEntry {
  id: string;
  habit_id: string;
  notes: string | null;
  completed_at: string;
}

export interface Checkin {
  id: string;
  mood: number;
  energy: number;
  notes: string | null;
  created_at: string;
}

export interface Briefing {
  id: string;
  type: BriefingType;
  content: string;
  sent_via: string;
  sent_at: string;
}

export interface Evolution {
  id: string;
  change_type: string;
  description: string;
  status: EvolutionStatus;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  all_day: boolean;
}
