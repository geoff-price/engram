import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectCalendarTrigger, fixEndTimes } from "../capture";
import { resolveColorId, isCalendarConfigured, getTimezone } from "../calendar";
import { calendarExtractionSchema } from "../types";

describe("detectCalendarTrigger", () => {
  it.each([
    ["add to my calendar: dinner Friday 7pm", true, "dinner Friday 7pm"],
    ["Add this to my calendar: game at 3pm", true, "game at 3pm"],
    ["put this on my calendar: dentist tomorrow", true, "dentist tomorrow"],
    ["Put on my calendar — team lunch Wed noon", true, "team lunch Wed noon"],
    ["please add to my calendar: recital Saturday 2pm", true, "recital Saturday 2pm"],
    ["can you add this to calendar: meeting 9am", true, "meeting 9am"],
    ["Add to calendar: soccer practice 4pm", true, "soccer practice 4pm"],
    ["Add calendar event: Placement Testing Saturday", true, "Placement Testing Saturday"],
    ["add a calendar event: team dinner Friday", true, "team dinner Friday"],
  ])("detects trigger in: %s", (input, triggered, expectedClean) => {
    const result = detectCalendarTrigger(input);
    expect(result.triggered).toBe(triggered);
    expect(result.cleanContent).toBe(expectedClean);
  });

  it.each([
    "I need to buy groceries",
    "Remember to call the doctor",
    "The calendar app is broken",
    "My calendar is full this week",
    "I added something to my calendar yesterday",
  ])("does not trigger on: %s", (input) => {
    const result = detectCalendarTrigger(input);
    expect(result.triggered).toBe(false);
    expect(result.cleanContent).toBe(input);
  });

  it("handles trigger with no content after it", () => {
    const result = detectCalendarTrigger("add to my calendar");
    expect(result.triggered).toBe(true);
    // Falls back to original content when cleaned is empty
    expect(result.cleanContent).toBe("add to my calendar");
  });

  it("extracts Jonah as person from trigger", () => {
    const result = detectCalendarTrigger("Add to my calendar, Jonah: soccer game Saturday 10am");
    expect(result.triggered).toBe(true);
    expect(result.person).toBe("Jonah");
    expect(result.cleanContent).toBe("soccer game Saturday 10am");
  });

  it("extracts Sarah as person from trigger", () => {
    const result = detectCalendarTrigger("add to my calendar: Sarah: dentist Tuesday 2pm");
    expect(result.triggered).toBe(true);
    expect(result.person).toBe("Sarah");
    expect(result.cleanContent).toBe("dentist Tuesday 2pm");
  });

  it("extracts Sydnie as person from trigger", () => {
    const result = detectCalendarTrigger("Add to my calendar, Sydnie: dance recital Friday 6pm");
    expect(result.triggered).toBe(true);
    expect(result.person).toBe("Sydnie");
    expect(result.cleanContent).toBe("dance recital Friday 6pm");
  });

  it("extracts family as person from trigger", () => {
    const result = detectCalendarTrigger("add to my calendar: family: lake house trip July 4");
    expect(result.triggered).toBe(true);
    expect(result.person).toBe("Family");
    expect(result.cleanContent).toBe("lake house trip July 4");
  });

  it("does not extract non-family name as person", () => {
    const result = detectCalendarTrigger("add to my calendar: dentist appointment Tuesday");
    expect(result.triggered).toBe(true);
    expect(result.person).toBeUndefined();
    expect(result.cleanContent).toBe("dentist appointment Tuesday");
  });
});

describe("resolveColorId", () => {
  beforeEach(() => {
    vi.stubEnv("CALENDAR_FAMILY_COLORS", "alice:6,bob:4,charlie:10,family:9");
    vi.stubEnv("CALENDAR_DEFAULT_MEMBER", "alice");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default member color when no person given", () => {
    expect(resolveColorId()).toBe("6");
  });

  it("returns matching family member color", () => {
    expect(resolveColorId("Bob")).toBe("4");
    expect(resolveColorId("charlie")).toBe("10");
  });

  it("is case-insensitive", () => {
    expect(resolveColorId("ALICE")).toBe("6");
    expect(resolveColorId("Bob")).toBe("4");
  });

  it("returns family color for multiple members", () => {
    expect(resolveColorId("Alice and Bob")).toBe("9");
    expect(resolveColorId("Bob, Charlie")).toBe("9");
  });

  it("returns default color for unknown person", () => {
    expect(resolveColorId("Dave")).toBe("6");
  });

  it("finds family member within longer string", () => {
    expect(resolveColorId("Bob's soccer game")).toBe("4");
  });
});

describe("isCalendarConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when no credentials set", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "");
    expect(isCalendarConfigured()).toBe(false);
  });

  it("returns false when partially configured", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "");
    expect(isCalendarConfigured()).toBe(false);
  });

  it("returns true when all credentials set", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "token");
    expect(isCalendarConfigured()).toBe(true);
  });
});

describe("getTimezone", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns configured timezone", () => {
    vi.stubEnv("CALENDAR_TIMEZONE", "America/Chicago");
    expect(getTimezone()).toBe("America/Chicago");
  });

  it("defaults to America/New_York", () => {
    vi.stubEnv("CALENDAR_TIMEZONE", "");
    expect(getTimezone()).toBe("America/New_York");
  });
});

describe("calendarExtractionSchema", () => {
  it("validates a single event", () => {
    const input = {
      events: [
        {
          title: "Soccer Game",
          start_datetime: "2026-03-21T10:00:00-04:00",
          end_datetime: "2026-03-21T11:00:00-04:00",
          location: "City Park",
          person: "Jonah",
          description: "Bring snacks and folding chairs",
        },
      ],
    };
    const result = calendarExtractionSchema.parse(input);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Soccer Game");
    expect(result.events[0].person).toBe("Jonah");
  });

  it("validates multiple events", () => {
    const input = {
      events: [
        {
          title: "Game 1",
          start_datetime: "2026-03-21T10:00:00-04:00",
          end_datetime: "2026-03-21T11:00:00-04:00",
          description: "",
        },
        {
          title: "Game 2",
          start_datetime: "2026-03-22T14:00:00-04:00",
          end_datetime: "2026-03-22T15:00:00-04:00",
          person: "Bob",
          description: "Wear blue jersey",
        },
      ],
    };
    const result = calendarExtractionSchema.parse(input);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].location).toBeUndefined();
    expect(result.events[1].person).toBe("Bob");
  });

  it("validates empty events array", () => {
    const result = calendarExtractionSchema.parse({ events: [] });
    expect(result.events).toHaveLength(0);
  });

  it("rejects missing required fields", () => {
    expect(() =>
      calendarExtractionSchema.parse({
        events: [{ title: "Test" }],
      }),
    ).toThrow();
  });
});

describe("fixEndTimes", () => {
  it("corrects 1-hour default when text has explicit range", () => {
    const events = [
      { start_datetime: "2026-03-23T18:30:00-05:00", end_datetime: "2026-03-23T19:30:00-05:00" },
    ];
    fixEndTimes(events, "wrestling every Monday 6:30-8:00pm");
    expect(events[0].end_datetime).toBe("2026-03-23T20:00:00-05:00");
  });

  it("corrects with dash and spaces", () => {
    const events = [
      { start_datetime: "2026-03-23T18:30:00-05:00", end_datetime: "2026-03-23T19:30:00-05:00" },
    ];
    fixEndTimes(events, "practice 6:30 - 8:00 PM at the gym");
    expect(events[0].end_datetime).toBe("2026-03-23T20:00:00-05:00");
  });

  it("does not change when duration is already correct", () => {
    const events = [
      { start_datetime: "2026-03-23T18:30:00-05:00", end_datetime: "2026-03-23T20:00:00-05:00" },
    ];
    fixEndTimes(events, "practice 6:30-8:00pm");
    expect(events[0].end_datetime).toBe("2026-03-23T20:00:00-05:00");
  });

  it("does not change when no time range in text", () => {
    const events = [
      { start_datetime: "2026-03-23T18:30:00-05:00", end_datetime: "2026-03-23T19:30:00-05:00" },
    ];
    fixEndTimes(events, "dentist appointment Tuesday 3pm");
    expect(events[0].end_datetime).toBe("2026-03-23T19:30:00-05:00");
  });

  it("applies fix to all events in batch", () => {
    const events = [
      { start_datetime: "2026-03-23T18:30:00-05:00", end_datetime: "2026-03-23T19:30:00-05:00" },
      { start_datetime: "2026-03-25T18:30:00-05:00", end_datetime: "2026-03-25T19:30:00-05:00" },
    ];
    fixEndTimes(events, "wrestling Mon and Wed 6:30-8:00pm");
    expect(events[0].end_datetime).toBe("2026-03-23T20:00:00-05:00");
    expect(events[1].end_datetime).toBe("2026-03-25T20:00:00-05:00");
  });
});

// Import afterEach at module level
import { afterEach } from "vitest";
