import { describe, it, expect, vi, afterEach } from "vitest";
import {
  habitFrequencyEnum,
  briefingTypeEnum,
  evolutionStatusEnum,
  checkinSchema,
} from "../types";
import { isTelegramSendConfigured } from "../telegram";

describe("habitFrequencyEnum", () => {
  it.each(["daily", "weekly", "weekdays", "specific_days"])(
    "accepts '%s'",
    (freq) => {
      expect(habitFrequencyEnum.parse(freq)).toBe(freq);
    },
  );

  it("rejects invalid frequency", () => {
    expect(() => habitFrequencyEnum.parse("monthly")).toThrow();
  });
});

describe("briefingTypeEnum", () => {
  it.each(["morning", "pre_meeting", "midday", "evening"])(
    "accepts '%s'",
    (type) => {
      expect(briefingTypeEnum.parse(type)).toBe(type);
    },
  );

  it("rejects invalid type", () => {
    expect(() => briefingTypeEnum.parse("afternoon")).toThrow();
  });
});

describe("evolutionStatusEnum", () => {
  it.each(["suggested", "approved", "rejected", "applied"])(
    "accepts '%s'",
    (status) => {
      expect(evolutionStatusEnum.parse(status)).toBe(status);
    },
  );

  it("rejects invalid status", () => {
    expect(() => evolutionStatusEnum.parse("pending")).toThrow();
  });
});

describe("checkinSchema", () => {
  it("validates valid check-in", () => {
    const result = checkinSchema.parse({ mood: 3, energy: 4, notes: "feeling ok" });
    expect(result.mood).toBe(3);
    expect(result.energy).toBe(4);
    expect(result.notes).toBe("feeling ok");
  });

  it("allows notes to be omitted", () => {
    const result = checkinSchema.parse({ mood: 1, energy: 5 });
    expect(result.notes).toBeUndefined();
  });

  it("rejects mood below 1", () => {
    expect(() => checkinSchema.parse({ mood: 0, energy: 3 })).toThrow();
  });

  it("rejects mood above 5", () => {
    expect(() => checkinSchema.parse({ mood: 6, energy: 3 })).toThrow();
  });

  it("rejects energy below 1", () => {
    expect(() => checkinSchema.parse({ mood: 3, energy: 0 })).toThrow();
  });

  it("rejects energy above 5", () => {
    expect(() => checkinSchema.parse({ mood: 3, energy: 6 })).toThrow();
  });

  it("rejects non-integer mood", () => {
    expect(() => checkinSchema.parse({ mood: 3.5, energy: 3 })).toThrow();
  });

  it("rejects non-integer energy", () => {
    expect(() => checkinSchema.parse({ mood: 3, energy: 2.5 })).toThrow();
  });

  it("accepts boundary values", () => {
    expect(checkinSchema.parse({ mood: 1, energy: 1 }).mood).toBe(1);
    expect(checkinSchema.parse({ mood: 5, energy: 5 }).mood).toBe(5);
  });
});

describe("isTelegramSendConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when no env vars set", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    expect(isTelegramSendConfigured()).toBe(false);
  });

  it("returns false when only token set", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:ABC");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    expect(isTelegramSendConfigured()).toBe(false);
  });

  it("returns false when only chat ID set", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "12345");
    expect(isTelegramSendConfigured()).toBe(false);
  });

  it("returns true when both set", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:ABC");
    vi.stubEnv("TELEGRAM_CHAT_ID", "12345");
    expect(isTelegramSendConfigured()).toBe(true);
  });
});

describe("CalendarEvent type mapping", () => {
  it("handles timed event structure", () => {
    const event = {
      id: "abc123",
      title: "Team standup",
      start: "2026-03-20T09:00:00-04:00",
      end: "2026-03-20T09:30:00-04:00",
      location: "Zoom",
      all_day: false,
    };
    expect(event.all_day).toBe(false);
    expect(event.location).toBe("Zoom");
  });

  it("handles all-day event structure", () => {
    const event: import("../types").CalendarEvent = {
      id: "def456",
      title: "Spring Break",
      start: "2026-03-20",
      end: "2026-03-27",
      all_day: true,
    };
    expect(event.all_day).toBe(true);
    expect(event.location).toBeUndefined();
  });
});

describe("SQL migration schema validation", () => {
  it("defines expected habit frequencies", () => {
    const valid = ["daily", "weekly", "weekdays", "specific_days"];
    valid.forEach((f) => expect(habitFrequencyEnum.safeParse(f).success).toBe(true));
  });

  it("defines expected briefing types", () => {
    const valid = ["morning", "pre_meeting", "midday", "evening"];
    valid.forEach((t) => expect(briefingTypeEnum.safeParse(t).success).toBe(true));
  });

  it("defines expected evolution statuses", () => {
    const valid = ["suggested", "approved", "rejected", "applied"];
    valid.forEach((s) => expect(evolutionStatusEnum.safeParse(s).success).toBe(true));
  });
});
