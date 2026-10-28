import { describe, expect, it } from "vitest";
import { getNextSessionEligibleForActivation } from "../academic-session-activation-eligibility";

const normalTimeline = [
  { id: 10, startDate: "2035-04-01", endDate: "2036-03-31", isActive: true, status: "active" },
  { id: 11, startDate: "2036-04-01", endDate: "2037-03-31", isActive: false, status: "draft" },
  { id: 12, startDate: "2037-04-01", endDate: "2038-03-31", isActive: false, status: "draft" },
];

describe("forward-only academic session activation visibility", () => {
  it("shows Activate only for the immediate next Draft session", () => {
    expect(getNextSessionEligibleForActivation(normalTimeline)).toBe(11);
  });

  it("allows the sole first Draft session when no session is active", () => {
    expect(getNextSessionEligibleForActivation([
      { id: 1, startDate: "2035-04-01", endDate: "2036-03-31", isActive: false, status: "draft" },
    ])).toBe(1);
  });

  it("hides activation for a historical archived session", () => {
    expect(getNextSessionEligibleForActivation([
      { id: 9, startDate: "2034-04-01", endDate: "2035-03-31", isActive: false, status: "archived" },
      ...normalTimeline,
    ])).toBe(11);
  });

  it("fails closed for skipped, overlapping, duplicate-start, and ambiguous first-session timelines", () => {
    expect(getNextSessionEligibleForActivation(normalTimeline)).not.toBe(12);
    expect(getNextSessionEligibleForActivation([
      { id: 10, startDate: "2035-04-01", endDate: "2036-04-01", isActive: true, status: "active" },
      { id: 11, startDate: "2036-04-01", endDate: "2037-03-31", isActive: false, status: "draft" },
    ])).toBeNull();
    expect(getNextSessionEligibleForActivation([
      { id: 10, startDate: "2035-04-01", endDate: "2036-03-31", isActive: true, status: "active" },
      { id: 11, startDate: "2035-04-01", endDate: "2037-03-31", isActive: false, status: "draft" },
    ])).toBeNull();
    expect(getNextSessionEligibleForActivation([
      { id: 1, startDate: "2035-04-01", endDate: "2036-03-31", isActive: false, status: "draft" },
      { id: 2, startDate: "2036-04-01", endDate: "2037-03-31", isActive: false, status: "draft" },
    ])).toBeNull();
  });
});
