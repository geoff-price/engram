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
- end_datetime: ISO 8601 with timezone offset. CRITICAL: If the text specifies an end time (e.g. "6:30-8:00pm", "until 5pm", "ends at 9"), you MUST use that exact end time. Only default to 1 hour after start if absolutely no end time or duration is mentioned.
- location: extract only if explicitly mentioned, omit otherwise
- person: the family member this event is for. If a name (e.g. "Jonah", "Sarah", "Sydnie") is mentioned ANYWHERE in the text — even just once at the beginning — set person to that name on EVERY event extracted. Only omit person if no family member name appears at all.
- description: IMPORTANT — put ALL additional details, notes, or context here that don't belong in the title. This includes instructions ("bring snacks"), requirements ("Math placement is required"), agendas, attendees, or any other info from the original text. The title should be short; everything else goes in description.
- Only extract events with a specific, resolvable date and time
- Skip anything vague ("sometime next week", "soon")
- If the text contains multiple events (e.g. a schedule), extract each one separately`,
  });
  return object;
}
