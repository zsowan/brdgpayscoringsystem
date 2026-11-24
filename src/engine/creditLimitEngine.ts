import type { DecisionBandDef, HardGateRule, SegmentCreditLimitRule } from '../models/configuration';
import type { CreditLimitCalculation } from '../models/decision';

/**
 * Looks up the proposed credit limit for a segment/tier pair from Credit Limit Rules —
 * the ONLY place a monetary amount is ever sourced. Decision Bands only ever supply the
 * Tier name; they never carry an amount themselves.
 */
export function getTierCreditLimit(
  creditLimitRules: Record<string, SegmentCreditLimitRule>,
  scoringModelId: string,
  tier: string | null | undefined
): number | null {
  if (!tier) return null;
  const rule = creditLimitRules[scoringModelId];
  return rule?.tiers[tier] ?? null;
}

/**
 * Final Credit Limit = MIN(Tier Credit Limit, Segment Maximum, Global Maximum BNPL
 * Limit). The score determines the Decision Band, the Decision Band determines the Tier
 * via `matchDecisionBand`; the Tier's Credit Limit Rule (looked up separately via
 * `getTierCreditLimit`) is the only source of the credit limit. Segment Maximum and
 * Global Maximum BNPL Limit are caps only — never a formula input, never derived from income.
 */
export function computeCreditLimit(
  tierCreditLimit: number | null,
  segmentMaxLimit: number,
  globalMaxLimit: number,
  /** The Tier actually assigned by the Decision Band, when known — used only to detect
   *  the configuration error below. Never used as a scoring or matching key here. */
  assignedTier?: string | null
): CreditLimitCalculation {
  const candidates = [tierCreditLimit, segmentMaxLimit, globalMaxLimit].filter(
    (v): v is number => v !== null && v !== undefined
  );

  const finalLimit = candidates.length > 0 ? Math.max(0, Math.min(...candidates)) : 0;

  // A Tier was assigned by the Decision Band (this is an Approve decision) but Credit
  // Limit Rules has no configured amount for it — never silently present this as a clean
  // approved limit; it must be surfaced as a configuration error to whoever reviews it.
  const configError = Boolean(assignedTier) && tierCreditLimit === null;

  return {
    tierCreditLimit,
    segmentMaxLimit,
    globalMaxLimit,
    finalLimit: Math.round(finalLimit * 100) / 100,
    configError,
    configErrorReason: configError
      ? `Tier "${assignedTier}" was approved but has no configured Tier Credit Limit in Credit Limit Rules.`
      : undefined,
  };
}

export function matchDecisionBand(bands: DecisionBandDef[], score: number): DecisionBandDef | null {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  const found = sorted.find((b) => score >= b.min && score < b.max);
  if (found) return found;
  // score === 1.0 (top of range) — treat as belonging to the highest band
  if (sorted.length > 0 && score >= sorted[sorted.length - 1].max) return sorted[sorted.length - 1];
  return sorted[0] ?? null;
}

/** Decision Band ranges must cover exactly 0–1, with no gaps and no overlaps. */
export function validateBandCoverage(bands: DecisionBandDef[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const sorted = [...bands].sort((a, b) => a.min - b.min);

  if (sorted.length === 0) {
    return { valid: false, issues: ['No bands configured'] };
  }
  if (sorted[0].min > 0) issues.push(`Gap before ${sorted[0].min}`);
  if (sorted[sorted.length - 1].max < 1) issues.push(`Gap after ${sorted[sorted.length - 1].max}`);

  for (const b of sorted) {
    if (b.min >= b.max) issues.push(`Band [${b.min}, ${b.max}) is invalid — min must be less than max`);
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.min > prev.max) issues.push(`Gap between ${prev.max} and ${cur.min}`);
    if (cur.min < prev.max) issues.push(`Overlap between [${prev.min},${prev.max}) and [${cur.min},${cur.max})`);
  }

  return { valid: issues.length === 0, issues };
}

/** REJECT/MANUAL_REVIEW bands must not carry a Tier; APPROVE bands must have one — a Tier is meaningless without an approve outcome, and an approve outcome can never resolve a credit limit without a Tier. */
export function validateBandTiers(bands: DecisionBandDef[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const b of [...bands].sort((a, b2) => a.min - b2.min)) {
    const range = `${(b.min * 100).toFixed(0)}%–${(Math.min(1, b.max) * 100).toFixed(0)}%`;
    if (b.outcome === 'APPROVE' && !b.tier) {
      issues.push(`Band ${range} is APPROVE but has no Tier assigned`);
    }
    if (b.outcome !== 'APPROVE' && b.tier) {
      issues.push(`Band ${range} is ${b.outcome.replace('_', ' ')} but has a Tier assigned — only APPROVE bands may have a Tier`);
    }
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Tier Credit Limits must be internally consistent for one segment: C <= B <= A, no
 * Tier may exceed the Segment Maximum, the Segment Maximum may not exceed the Global
 * Maximum BNPL Limit, every monetary value must be >= 0, the Segment Maximum must be
 * greater than 0, and every Tier actually assigned by that segment's Decision Bands
 * (`approveTierNames`) must carry a valid (> 0) configured amount — a missing or zero
 * amount for a live Tier is a configuration error, never an intentional 0 KWD limit.
 */
export function validateCreditLimitRule(
  rule: SegmentCreditLimitRule,
  globalMaxBnplLimit: number,
  approveTierNames: string[] = []
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const tierC = rule.tiers['Tier C'];
  const tierB = rule.tiers['Tier B'];
  const tierA = rule.tiers['Tier A'];

  if (rule.segmentMaximumKwd <= 0) issues.push('Segment Maximum must be greater than 0');
  for (const [tierName, amount] of Object.entries(rule.tiers)) {
    if (amount < 0) issues.push(`${tierName} limit must be >= 0`);
  }
  for (const tierName of approveTierNames) {
    const amount = rule.tiers[tierName];
    if (typeof amount !== 'number' || amount <= 0) {
      issues.push(`${tierName} has no valid configured credit limit, but Decision Bands assign this Tier on Approve — this is a configuration error, not an intentional 0 KWD limit`);
    }
  }

  if (typeof tierC === 'number' && typeof tierB === 'number' && tierC > tierB) {
    issues.push(`Tier C limit (${tierC}) must not exceed Tier B (${tierB})`);
  }
  if (typeof tierB === 'number' && typeof tierA === 'number' && tierB > tierA) {
    issues.push(`Tier B limit (${tierB}) must not exceed Tier A (${tierA})`);
  }

  for (const [tierName, amount] of Object.entries(rule.tiers)) {
    if (amount > rule.segmentMaximumKwd) {
      issues.push(`${tierName} limit (${amount}) must not exceed the Segment Maximum (${rule.segmentMaximumKwd})`);
    }
  }

  if (rule.segmentMaximumKwd > globalMaxBnplLimit) {
    issues.push(`Segment Maximum (${rule.segmentMaximumKwd}) must not exceed the Global Maximum BNPL Limit (${globalMaxBnplLimit})`);
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Reason code recorded when a gate's input is unavailable at runtime and the gate itself
 * has no custom `dataUnavailableReasonCode` configured. An admin may always override this
 * per-gate under Advanced Configuration; leaving it unset is a valid, common playground/demo
 * choice, never a configuration error.
 */
export const DEFAULT_DATA_UNAVAILABLE_REASON_CODE = 'DATA_UNAVAILABLE';

/**
 * A Hard Gate's condition must be complete (an input field, and a comparison value
 * unless the operator is is_null/is_not_null), and it must carry a failure Reason Code —
 * so every gate always resolves to a clearly-reasoned Pass or Fail. The unavailable-data
 * reason code is optional: a gate with none configured still resolves indeterminate data
 * to Manual Review, using `DEFAULT_DATA_UNAVAILABLE_REASON_CODE` (see decisionEngine.ts),
 * so its absence is never a validation error.
 */
export function validateHardGate(gate: HardGateRule): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!gate.input) issues.push(`Gate "${gate.name}" has no condition input field configured`);
  const needsValue = gate.operator !== 'is_null' && gate.operator !== 'is_not_null';
  if (needsValue && (gate.value === undefined || gate.value === '')) {
    issues.push(`Gate "${gate.name}" condition is incomplete — operator "${gate.operator}" requires a comparison value`);
  }
  if (!gate.reasonCode) issues.push(`Gate "${gate.name}" has no failure Reason Code configured`);
  return { valid: issues.length === 0, issues };
}
