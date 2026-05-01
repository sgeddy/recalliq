const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LONG_TERM_GROWTH_FACTOR = 2;

// Mirrors the same function in scheduler.ts — kept local to avoid circular deps.
function intervalDays(index: number, sequence: number[]): number {
  if (index < sequence.length) return sequence[index] as number;
  const last = sequence[sequence.length - 1] as number;
  return Math.round(last * Math.pow(LONG_TERM_GROWTH_FACTOR, index - (sequence.length - 1)));
}

export interface CardStatsForPreparedness {
  intervalIndex: number;
  attempts: number;
  correct: number;
  // null = never reviewed. Used to compute recency decay.
  lastReviewedAt: Date | null;
}

export interface DomainStatsForPreparedness {
  // Official exam domain weight, e.g. 22 for 22%. Use equal weight if unavailable.
  weightPercent: number;
  cards: CardStatsForPreparedness[];
}

/**
 * Computes a 0–100 preparedness score.
 *
 * Design goals:
 * - Starts at 0% with no reviews
 * - First-pass correct answers earn meaningful credit (no "stuck near zero" trap)
 * - 90%+ requires consistent correct answers over time across all domains
 * - Both pass rate AND repetition depth matter
 *
 * Per-card confidence:
 *   retentionDepth = max(BASELINE_DEPTH, (intervalIndex / maxIntervalIndex) ^ 0.7)
 *     → Concave (square-root-ish) curve: a single correct first review yields
 *       ~0.23 instead of the previous 0.04. Only sustained correct answers
 *       across many cycles push the score toward 1.0.
 *       Index 1/8 ≈ 0.232, Index 4/8 ≈ 0.616, Index 7/8 ≈ 0.911
 *     A floor of BASELINE_DEPTH (0.15) ensures any reviewed card contributes
 *     at least the baseline — a learner who's answered every card once should
 *     score noticeably better than one who's answered nothing.
 *
 *   passRate = correct / attempts
 *     → Straight ratio.
 *
 *   recencyFactor = exp(-ln2 * daysSince / currentIntervalDays)
 *     → 1.0 when just reviewed, 0.5 when one full interval has elapsed.
 *
 *   cardScore = retentionDepth × passRate × recencyFactor
 *
 * Per-domain score:   mean(cardScore) over ALL cards (including unreviewed = 0)
 * Overall score:      Σ(domainScore × domainWeight) / Σ(domainWeight) × 100
 */
const BASELINE_DEPTH = 0.15;
const DEPTH_EXPONENT = 0.7;

export function computePreparednessScore(
  domains: DomainStatsForPreparedness[],
  defaultIntervals: number[],
  now: Date,
): number {
  if (domains.length === 0 || defaultIntervals.length === 0) return 0;

  const maxIntervalIndex = defaultIntervals.length;
  const totalWeight = domains.reduce((s, d) => s + d.weightPercent, 0);
  if (totalWeight === 0) return 0;

  let weightedSum = 0;

  for (const domain of domains) {
    if (domain.cards.length === 0) continue;

    let domainTotal = 0;
    for (const card of domain.cards) {
      if (card.attempts === 0) {
        // Unreviewed card contributes 0 — drags the domain average down.
        continue;
      }

      // retentionDepth: concave curve (power 0.7) so a single correct
      // first-pass earns meaningful credit. A baseline floor ensures any
      // reviewed card contributes at least BASELINE_DEPTH. The curve still
      // rewards depth: only sustained correct answers approach 1.0.
      const normalizedDepth = Math.min(card.intervalIndex / maxIntervalIndex, 1);
      const retentionDepth = Math.max(BASELINE_DEPTH, Math.pow(normalizedDepth, DEPTH_EXPONENT));

      const passRate = card.correct / card.attempts;

      // recencyFactor: exponential decay with half-life = currentIntervalDays.
      const currentIntervalDays = intervalDays(card.intervalIndex, defaultIntervals);
      let recencyFactor: number;
      if (card.lastReviewedAt === null) {
        recencyFactor = 0;
      } else {
        const daysSince = (now.getTime() - card.lastReviewedAt.getTime()) / MS_PER_DAY;
        recencyFactor = Math.exp(-0.693 * (daysSince / Math.max(currentIntervalDays, 1)));
      }

      domainTotal += retentionDepth * passRate * recencyFactor;
    }

    // Divide by ALL cards (not just attempted) so unreviewed cards drag score down
    const domainScore = domainTotal / domain.cards.length;
    weightedSum += domainScore * domain.weightPercent;
  }

  return Math.round((weightedSum / totalWeight) * 100);
}

/** Maps a raw preparedness score to its label threshold. */
export function preparednessLabel(score: number): {
  label: string;
  color: "red" | "amber" | "green" | "indigo";
} {
  if (score >= 90) return { label: "Exam-ready", color: "indigo" };
  if (score >= 75) return { label: "Solid", color: "green" };
  if (score >= 50) return { label: "Building", color: "amber" };
  return { label: "Beginner", color: "red" };
}
