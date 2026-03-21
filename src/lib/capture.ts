import { generateEmbedding, extractMetadata, extractCalendarEvents } from "./ai";
import { insertThought } from "./db";
import {
  createCalendarEvents,
  isCalendarConfigured,
  getTimezone,
} from "./calendar";
import type { ThoughtMetadata, CalendarEventResult } from "./types";

const CALENDAR_TRIGGER =
  /(?:please\s+|can\s+you\s+)?(?:(?:add|put)\s+(?:this\s+)?(?:to|on)\s+(?:my\s+)?calendar|add\s+(?:a\s+)?calendar\s+event)[:\s\u2014\u2013-]*/i;

const FAMILY_MEMBERS = ["sarah", "sydnie", "jonah", "family"];

export function detectCalendarTrigger(content: string): {
  triggered: boolean;
  cleanContent: string;
  person?: string;
} {
  if (!CALENDAR_TRIGGER.test(content)) {
    return { triggered: false, cleanContent: content };
  }
  let cleaned = content.replace(CALENDAR_TRIGGER, "").trim();
  // Strip leading punctuation (comma, colon, dash) left after trigger removal
  cleaned = cleaned.replace(/^[,:\s\u2014\u2013-]+/, "").trim();
  if (!cleaned) return { triggered: true, cleanContent: content };

  // Check if the first word after the trigger is a family member name
  const match = cleaned.match(/^(\w+)[,:\s]/);
  const firstWord = match?.[1]?.toLowerCase();
  let person: string | undefined;

  if (firstWord && FAMILY_MEMBERS.includes(firstWord)) {
    person = firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
    // Remove the person name (and trailing punctuation/whitespace) from content
    cleaned = cleaned.replace(/^\w+[,:\s]+/, "").trim();
  }

  return { triggered: true, cleanContent: cleaned || content, person };
}

// Parse a time like "8:00pm", "6:30PM", "8pm", "14:00" into { hours, minutes }
function parseTime(timeStr: string): { hours: number; minutes: number } | null {
  const match = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2] || "0", 10);
  const ampm = match[3]?.toLowerCase();
  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;
  return { hours, minutes };
}

// If the original text has an explicit time range (e.g. "6:30-8:00pm"),
// override the LLM's end time which often defaults to start+1hr
export function fixEndTimes(
  events: Array<{ start_datetime: string; end_datetime: string }>,
  text: string,
): void {
  // Match patterns like "6:30-8:00pm", "6:30pm-8pm", "6:30 - 8:00 PM"
  const rangePattern = /(\d{1,2}(?::\d{2})?)\s*(?:am|pm)?\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)/gi;
  const match = rangePattern.exec(text);
  if (!match) return;

  const endTimeStr = match[2] + match[3]; // e.g. "8:00pm"
  const parsed = parseTime(endTimeStr);
  if (!parsed) return;

  // Apply the correct end time to all events that have the wrong duration
  for (const event of events) {
    const start = new Date(event.start_datetime);
    const end = new Date(event.end_datetime);
    const durationMs = end.getTime() - start.getTime();
    const oneHourMs = 60 * 60 * 1000;

    // Only fix if the LLM defaulted to exactly 1 hour
    if (Math.abs(durationMs - oneHourMs) < 60000) {
      const correctedEnd = new Date(start);
      correctedEnd.setHours(parsed.hours, parsed.minutes, 0, 0);
      // If corrected end is before start (e.g. crossed midnight), skip
      if (correctedEnd.getTime() > start.getTime()) {
        // Preserve the original timezone offset from start_datetime
        const tzMatch = event.start_datetime.match(/([+-]\d{2}:\d{2})$/);
        const tz = tzMatch ? tzMatch[1] : "";
        const pad = (n: number) => n.toString().padStart(2, "0");
        event.end_datetime = `${correctedEnd.getFullYear()}-${pad(correctedEnd.getMonth() + 1)}-${pad(correctedEnd.getDate())}T${pad(parsed.hours)}:${pad(parsed.minutes)}:00${tz}`;
      }
    }
  }
}

export async function captureThought(
  content: string,
  source: string,
): Promise<{
  id: string;
  metadata: ThoughtMetadata;
  calendarResults?: CalendarEventResult[];
}> {
  const { triggered, cleanContent } = detectCalendarTrigger(content);
  const shouldCalendar = triggered && isCalendarConfigured();

  const now = new Date();
  const timezone = getTimezone();

  const [embedding, metadata, calendarExtraction] = await Promise.all([
    generateEmbedding(cleanContent),
    extractMetadata(cleanContent),
    shouldCalendar
      ? extractCalendarEvents(
          cleanContent,
          now.toLocaleDateString("en-CA", { timeZone: timezone }),
          timezone,
        )
      : Promise.resolve(undefined),
  ]);

  let calendarResults: CalendarEventResult[] | undefined;
  const storedMetadata: Record<string, unknown> = { ...metadata };

  if (calendarExtraction?.events?.length) {
    // Override person on all events if detected from trigger phrase
    const { person } = detectCalendarTrigger(content);
    if (person) {
      for (const event of calendarExtraction.events) {
        event.person = person;
      }
    }
    // Fix end times: if the text has an explicit time range, enforce it
    fixEndTimes(calendarExtraction.events, cleanContent);
    calendarResults = await createCalendarEvents(calendarExtraction.events);
    storedMetadata.is_calendar_event = true;
    storedMetadata.calendar_events = calendarResults;

    const allCreated = calendarResults.every((e) => e.status === "created");
    const anyCreated = calendarResults.some((e) => e.status === "created");
    storedMetadata.calendar_action = allCreated
      ? "created"
      : anyCreated
        ? "partial"
        : "failed";
  }

  const id = await insertThought(
    cleanContent,
    embedding,
    storedMetadata as ThoughtMetadata,
    source,
  );

  return { id, metadata, calendarResults };
}
