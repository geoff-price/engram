import type { CalendarEventResult } from "./types";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface CalendarEvent {
  title: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  colorId?: string;
}

let cachedToken: { token: string; expiry: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiry - 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Calendar credentials not configured");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${error}`);
  }

  const data: TokenResponse = await response.json();
  cachedToken = {
    token: data.access_token,
    expiry: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

function parseFamilyColors(): Map<string, string> {
  const config = process.env.CALENDAR_FAMILY_COLORS || "";
  const map = new Map<string, string>();
  for (const pair of config.split(",")) {
    const [name, colorId] = pair.split(":");
    if (name && colorId) {
      map.set(name.trim().toLowerCase(), colorId.trim());
    }
  }
  return map;
}

export function resolveColorId(person?: string): string | undefined {
  const colors = parseFamilyColors();
  const defaultMember = (
    process.env.CALENDAR_DEFAULT_MEMBER || ""
  ).toLowerCase();

  if (!person) {
    return colors.get(defaultMember);
  }

  const normalized = person.toLowerCase();
  const familyNames = [...colors.keys()].filter((name) => name !== "family");
  const mentioned = familyNames.filter((name) => normalized.includes(name));

  if (mentioned.length > 1) {
    return colors.get("family") || colors.get(defaultMember);
  }

  if (mentioned.length === 1) {
    return colors.get(mentioned[0]);
  }

  return colors.get(defaultMember);
}

export function isCalendarConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

export function getTimezone(): string {
  return process.env.CALENDAR_TIMEZONE || "America/New_York";
}

async function createCalendarEvent(event: CalendarEvent): Promise<string> {
  const accessToken = await getAccessToken();
  const timezone = getTimezone();

  const body: Record<string, unknown> = {
    summary: event.title,
    start: { dateTime: event.start, timeZone: timezone },
    end: { dateTime: event.end, timeZone: timezone },
  };

  if (event.location) {
    body.location = event.location;
  }
  if (event.description) {
    body.description = event.description;
  }
  if (event.colorId) {
    body.colorId = event.colorId;
  }

  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Calendar API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.id;
}

export async function listCalendarEvents(
  startDate: string,
  endDate: string,
): Promise<
  Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    location?: string;
    all_day: boolean;
  }>
> {
  if (!isCalendarConfigured()) return [];

  const accessToken = await getAccessToken();
  const timezone = getTimezone();

  const params = new URLSearchParams({
    timeMin: new Date(`${startDate}T00:00:00`).toISOString(),
    timeMax: new Date(`${endDate}T23:59:59`).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
    timeZone: timezone,
  });

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Calendar API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const items = data.items || [];

  return items.map(
    (item: {
      id: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      location?: string;
    }) => ({
      id: item.id,
      title: item.summary || "(No title)",
      start: item.start?.dateTime || item.start?.date || "",
      end: item.end?.dateTime || item.end?.date || "",
      location: item.location,
      all_day: !item.start?.dateTime,
    }),
  );
}

export async function createCalendarEvents(
  events: Array<{
    title: string;
    start_datetime: string;
    end_datetime: string;
    location?: string;
    person?: string;
    description?: string;
  }>,
): Promise<CalendarEventResult[]> {
  const MAX_EVENTS = 10;
  const results: CalendarEventResult[] = [];
  const capped = events.slice(0, MAX_EVENTS);

  if (events.length > MAX_EVENTS) {
    results.push({
      title: `⚠️ ${events.length - MAX_EVENTS} additional events skipped`,
      start: "",
      end: "",
      status: "failed",
      error: `Only ${MAX_EVENTS} events can be created at once. For recurring events, consider using Google Calendar's repeat feature.`,
    });
  }

  for (const event of capped) {
    const colorId = resolveColorId(event.person);
    try {
      const eventId = await createCalendarEvent({
        title: event.title,
        start: event.start_datetime,
        end: event.end_datetime,
        location: event.location,
        description: event.description,
        colorId,
      });
      results.push({
        title: event.title,
        start: event.start_datetime,
        end: event.end_datetime,
        location: event.location,
        person: event.person,
        color_id: colorId,
        event_id: eventId,
        status: "created",
      });
    } catch (error) {
      results.push({
        title: event.title,
        start: event.start_datetime,
        end: event.end_datetime,
        location: event.location,
        person: event.person,
        color_id: colorId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}
