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

export function detectCalendarTrigger(content: string): {
  triggered: boolean;
  cleanContent: string;
} {
  if (!CALENDAR_TRIGGER.test(content)) {
    return { triggered: false, cleanContent: content };
  }
  const cleaned = content.replace(CALENDAR_TRIGGER, "").trim();
  return { triggered: true, cleanContent: cleaned || content };
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
