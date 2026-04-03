import { describe, expect, it } from "vitest";

import { getNextReview } from "../scheduler.js";

// First element 0 = immediate initial learning session; rest = expanding review intervals.
const INTERVALS = [0, 1, 4, 10, 25];
const FIXED_NOW = new Date("2026-01-01T12:00:00.000Z");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(FIXED_NOW.getTime() + days * MS_PER_DAY);
}

describe("getNextReview", () => {
  describe("when the card is passed", () => {
    it("should advance intervalIndex by 1", () => {
      const result = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: 1, passed: true },
        INTERVALS,
        FIXED_NOW,
      );

      expect(result.nextIntervalIndex).toBe(2);
    });

    it("should schedule next review using the advanced interval", () => {
      const result = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: 1, passed: true },
        INTERVALS,
        FIXED_NOW,
      );

      // Passed at index 1 → advances to index 2 → interval[2] = 4 days
      expect(result.nextScheduledAt).toEqual(daysFromNow(4));
    });

    it("should never mark as completed", () => {
      const lastIndex = INTERVALS.length - 1;
      const result = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: lastIndex, passed: true },
        INTERVALS,
        FIXED_NOW,
      );

      expect(result.completed).toBe(false);
    });

    it("should continue scheduling beyond the last defined interval", () => {
      const lastIndex = INTERVALS.length - 1;
      const result = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: lastIndex, passed: true },
        INTERVALS,
        FIXED_NOW,
      );

      // lastIndex = 4 (25 days) → nextIndex = 5 → 25 * 2^1 = 50 days
      expect(result.nextIntervalIndex).toBe(lastIndex + 1);
      expect(result.nextScheduledAt).toEqual(daysFromNow(50));
    });

    it("should double the interval for each additional step beyond the defined sequence", () => {
      // Index 5 is one past last (last = index 4 = 25 days)
      // nextIndex = 6 → 25 * 2^2 = 100 days
      const result = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: 5, passed: true },
        INTERVALS,
        FIXED_NOW,
      );

      expect(result.nextScheduledAt).toEqual(daysFromNow(100));
    });
  });

  describe("when the card is failed", () => {
    it("should step back one interval level", () => {
      const result = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: 3, passed: false },
        INTERVALS,
        FIXED_NOW,
      );

      expect(result.nextIntervalIndex).toBe(2);
    });

    it("should schedule retry using the stepped-back interval", () => {
      const result = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: 3, passed: false },
        INTERVALS,
        FIXED_NOW,
      );

      // Stepped back to index 2 → interval[2] = 4 days
      expect(result.nextScheduledAt).toEqual(daysFromNow(4));
    });

    it("should not step back below index 1", () => {
      const result = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: 1, passed: false },
        INTERVALS,
        FIXED_NOW,
      );

      expect(result.nextIntervalIndex).toBe(1);
    });

    it("should step to index 1 when failing the initial learning session at index 0", () => {
      const result = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: 0, passed: false },
        INTERVALS,
        FIXED_NOW,
      );

      // Minimum index 1 prevents re-triggering the zero-delay initial session
      expect(result.nextIntervalIndex).toBe(1);
      expect(result.nextScheduledAt).toEqual(daysFromNow(1));
    });

    it("should never mark as completed", () => {
      const lastIndex = INTERVALS.length - 1;
      const result = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: lastIndex, passed: false },
        INTERVALS,
        FIXED_NOW,
      );

      expect(result.completed).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should throw when intervals array is empty", () => {
      expect(() =>
        getNextReview(
          { enrollmentId: "e1", cardId: "c1", intervalIndex: 0, passed: true },
          [],
          FIXED_NOW,
        ),
      ).toThrow("Interval sequence must not be empty");
    });

    it("should throw when intervalIndex is negative", () => {
      expect(() =>
        getNextReview(
          { enrollmentId: "e1", cardId: "c1", intervalIndex: -1, passed: true },
          INTERVALS,
          FIXED_NOW,
        ),
      ).toThrow("out of range");
    });
  });

  describe("timing correctness", () => {
    it("should use the provided now timestamp, not real clock", () => {
      const customNow = new Date("2024-06-15T00:00:00.000Z");
      const result = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: 1, passed: true },
        [0, 1, 7],
        customNow,
      );

      // Passed at index 1 → index 2 → 7 days
      expect(result.nextScheduledAt).toEqual(new Date("2024-06-22T00:00:00.000Z"));
    });

    it("should produce later dates for higher interval indices", () => {
      const result1 = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: 1, passed: true },
        INTERVALS,
        FIXED_NOW,
      );
      const result2 = getNextReview(
        { enrollmentId: "e1", cardId: "c1", intervalIndex: 2, passed: true },
        INTERVALS,
        FIXED_NOW,
      );

      expect(result1.nextScheduledAt.getTime()).toBeLessThan(result2.nextScheduledAt.getTime());
    });
  });
});
