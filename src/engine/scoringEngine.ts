import type { ScoringInputConfig, ScoringModel } from '../models/configuration';
import type { CustomerRecord } from '../models/customer';
import type { ScoringBreakdownRow } from '../models/decision';
import { normalizeInput, totalWeight } from './normalization';

export interface ScoringOutcome {
  rows: ScoringBreakdownRow[];
  finalScore: number;
  unavailableWeightPct: number;
  /** True when any factor configured as "manual_review" was missing — the caller should force the overall decision to Manual Review. */
  manualReviewTriggered: boolean;
}

function isRawMissing(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function exclusionReason(input: ScoringInputConfig, data: CustomerRecord): string {
  if (input.missingDataBehavior === 'manual_review') {
    return 'This factor was unavailable and requires manual review before a decision can be made.';
  }
  if (input.field === 'cinet_score') {
    const status = data.cinet_status;
    if (status === 'TIMEOUT') return 'CINET service unavailable.';
    if (status === 'ERROR') return 'CINET service returned an error.';
    return 'CINET assessment has not been performed.';
  }
  return 'This factor was unavailable and was excluded from the assessment.';
}

/**
 * Normalizes every enabled, available input, weights it, and sums to a final 0..1 score.
 *
 * A factor configured with missingDataBehavior "exclude_and_reweight" or "manual_review"
 * is dropped entirely from the calculation when its raw value is missing — never scored
 * with a fallback, never penalized — and the remaining available factors' configured
 * weights are proportionally re-normalized back up to 100% for this one decision only.
 * The stored/configured weights themselves are never modified. "manual_review" factors
 * additionally set `manualReviewTriggered` so the decision engine can force the overall
 * outcome to Manual Review.
 *
 * unavailableWeightPct only reflects factors that used their nullDefault fallback
 * (traditional "missing data" handling) — an excluded factor contributes nothing to
 * it, since it was never part of this decision's scoring pie in the first place.
 */
export function computeScore(model: ScoringModel, data: CustomerRecord): ScoringOutcome {
  const enabledInputs = model.inputs.filter((i) => i.enabled);

  const availableInputs: ScoringInputConfig[] = [];
  const excludedInputs: ScoringInputConfig[] = [];
  let manualReviewTriggered = false;
  for (const input of enabledInputs) {
    const missing = isRawMissing(data[input.field]);
    if (missing && (input.missingDataBehavior === 'exclude_and_reweight' || input.missingDataBehavior === 'manual_review')) {
      excludedInputs.push(input);
      if (input.missingDataBehavior === 'manual_review') manualReviewTriggered = true;
    } else {
      availableInputs.push(input);
    }
  }

  const totalAvailableWeight = totalWeight(availableInputs) || 100;

  let weightedSum = 0;
  let unavailableEffectiveWeight = 0;
  const rows: ScoringBreakdownRow[] = [];

  for (const input of availableInputs) {
    const rawValue = data[input.field];
    const { score, reason, missing } = normalizeInput(input, rawValue);
    const effectiveWeight = (input.weight / totalAvailableWeight) * 100;
    const contribution = score * (effectiveWeight / 100);
    weightedSum += contribution;
    if (missing) unavailableEffectiveWeight += effectiveWeight;

    rows.push({
      field: input.field,
      displayName: input.displayName,
      rawValue: rawValue ?? null,
      method: input.method,
      normalizedScore: score,
      weight: input.weight,
      effectiveWeight,
      contribution,
      reason,
      missing,
      excluded: false,
      missingDataBehavior: input.missingDataBehavior,
    });
  }

  for (const input of excludedInputs) {
    rows.push({
      field: input.field,
      displayName: input.displayName,
      rawValue: null,
      method: input.method,
      normalizedScore: null,
      weight: input.weight,
      effectiveWeight: null,
      contribution: 0,
      reason: exclusionReason(input, data),
      missing: true,
      excluded: true,
      missingDataBehavior: input.missingDataBehavior,
    });
  }

  return {
    rows,
    finalScore: Math.min(1, Math.max(0, weightedSum)),
    unavailableWeightPct: unavailableEffectiveWeight,
    manualReviewTriggered,
  };
}
