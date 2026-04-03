import type { ReviewResult, ScheduleOutput } from "@recalliq/types";

export type IntervalSequence = number[];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Beyond the defined sequence, each successive review doubles the previous interval,
// supporting indefinite subscription-based retention.
const LONG_TERM_GROWTH_FACTOR = 2;

// Returns interval days for a given index.
// Within the defined sequence: looks up directly.
// Beyond the last defined interval: grows exponentially from that value.
function computeIntervalDays(index: number, intervals: IntervalSequence): number {
  if (index < intervals.length) {
    return intervals[index] as number;
  }
  const lastInterval = intervals[intervals.length - 1] as number;
  const stepsBeyond = index - (intervals.length - 1);
  return Math.round(lastInterval * Math.pow(LONG_TERM_GROWTH_FACTOR, stepsBeyond));
}

/**
 * Calculates the next review date and interval index for a card.
 *
 * Scheduling rules:
 * - passed → advance to intervalIndex + 1
 * - failed → step back one level, minimum index 1
 *   (index 0 is the immediate initial learning session; failing a review
 *   never re-triggers that zero-delay session)
 * - Reviews continue indefinitely: beyond the defined sequence, intervals
 *   double per step (e.g. 365 → 730 → 1460 days…)
 *
 * @param result - The outcome of the review session
 * @param intervals - Interval sequence in days; first element should be 0 for
 *   the immediate initial learning session
 * @param now - Reference timestamp (defaults to current time; injectable for tests)
 */
export function getNextReview(
  result: ReviewResult,
  intervals: IntervalSequence,
  now: Date = new Date(),
): ScheduleOutput {
  if (intervals.length === 0) {
    throw new Error("Interval sequence must not be empty");
  }

  const currentIndex = result.intervalIndex;

  if (currentIndex < 0) {
    throw new Error(`intervalIndex ${currentIndex} is out of range: must be >= 0`);
  }

  // Pass: advance one step. Fail: step back one, but never below 1 to avoid
  // re-triggering the zero-delay initial session.
  const nextIntervalIndex = result.passed ? currentIndex + 1 : Math.max(1, currentIndex - 1);

  const daysUntilNext = computeIntervalDays(nextIntervalIndex, intervals);
  const nextScheduledAt = new Date(now.getTime() + daysUntilNext * MS_PER_DAY);

  return {
    nextScheduledAt,
    nextIntervalIndex,
    // Reviews are indefinite — subscriptions never auto-complete via the scheduler.
    completed: false,
  };
}
