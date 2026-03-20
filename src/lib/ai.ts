import { embed, generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  metadataSchema,
  calendarExtractionSchema,
  type ThoughtMetadata,
  type CalendarExtraction,
} from "./types";

export async function generateEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: text,
  });
  return embedding;
}

export async function extractMetadata(
  content: string,
): Promise<ThoughtMetadata> {
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: metadataSchema,
    prompt: `Extract structured metadata from this thought. Be concise.

Thought: "${content}"

Rules:
- people: extract full names mentioned
- action_items: implied tasks or things to do
- dates_mentioned: in YYYY-MM-DD format
- topics: 1-3 short category tags
- type: classify as observation, task, idea, reference, person_note, decision, or meeting_note`,
  });
  return object;
}

export async function extractCalendarEvents(
  content: string,
  currentDate: string,
  timezone: string,
): Promise<CalendarExtraction> {
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: calendarExtractionSchema,
    prompt: `Extract calendar events from this text. Today is ${currentDate} (timezone: ${timezone}).

Text: "${content}"

Rules:
- title: short, human-readable event title
- start_datetime: ISO 8601 with timezone offset, resolved against today's date (handle "tomorrow", "next Monday", "this Saturday", etc.)
- end_datetime: ISO 8601 with timezone offset (default to 1 hour after start if duration not stated)
- location: extract only if explicitly mentioned, omit otherwise
- person: the family member this event is for — extract the most relevant name if mentioned, omit if the event is clearly for the message sender
- Only extract events with a specific, resolvable date and time
- Skip anything vague ("sometime next week", "soon")
- If the text contains multiple events (e.g. a schedule), extract each one separately`,
  });
  return object;
}
