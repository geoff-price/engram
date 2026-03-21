import { generateEmbedding, extractMetadata, extractCalendarEvents } from "./ai";
import { insertThought } from "./db";
import {
  createCalendarEvents,
  isCalendarConfigured,
  getTimezone,
} from "./calendar";
import type { ThoughtMetadata, CalendarEventResult } from "./types";

const CALENDAR_TRIGGER =
  /(?:please\s+|can\s+you\s+)?(?:add|put)\s+(?:this\s+)?(?:to|on)\s+(?:my\s+)?calendar[:\s\u2014\u2013-]*/i;

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
