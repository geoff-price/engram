import { describe, it, expect } from "vitest";
import { getTimeWindow } from "../life-engine-agent";

describe("getTimeWindow", () => {
  it("returns morning for 7:00 AM", () => {
    expect(getTimeWindow(7, 0)).toBe("morning");
  });

  it("returns midday for 12:00 PM", () => {
    expect(getTimeWindow(12, 0)).toBe("midday");
  });

  it("returns afternoon for 3:00 PM", () => {
    expect(getTimeWindow(15, 0)).toBe("afternoon");
  });

  it("returns evening for 6:00 PM", () => {
    expect(getTimeWindow(18, 0)).toBe("evening");
  });

  it("returns quiet for 10:00 PM", () => {
    expect(getTimeWindow(22, 0)).toBe("quiet");
  });

  it("returns quiet for 3:00 AM", () => {
    expect(getTimeWindow(3, 0)).toBe("quiet");
  });

  it("returns morning at boundary 8:59 AM", () => {
    expect(getTimeWindow(8, 59)).toBe("morning");
  });

  it("returns midday at 11:00 AM", () => {
    expect(getTimeWindow(11, 0)).toBe("midday");
  });
});
