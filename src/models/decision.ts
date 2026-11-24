import type { CustomerRecord } from './customer';
import type { DecisionOutcome, MissingDataBehavior, NormalizationMethod } from './configuration';
import type { PreapprovedMatchStatus } from './preapproved';
import type { AssessmentType, CinetStatus } from './cinet';

export interface ScoringBreakdownRow {
  field: string;
  displayName: string;
  rawValue: unknown;
  method: NormalizationMethod;
  /** null when the factor was excluded from this decision entirely. */
  normalizedScore: number | null;
  /** Configured weight — the stored business-model definition. Never changed per-decision. */
  weight: number;
  /**
   * Effective weight actually used for THIS decision, after excluding unavailable
   * factors and re-normalizing the rest back to 100%. Null when excluded.
   */
  effectiveWeight: number | null;
  contribution: number;
  reason: string;
  missing: boolean;
  /** True when this factor was dropped from scoring entirely (not just given a null-default score). */
  excluded: boolean;
  /** This factor's configured behavior for missing data — explains WHY it was excluded (or not). */
  missingDataBehavior: MissingDataBehavior;
}

export interface HardGateResult {
  ruleId: string;
  name: string;
  passed: boolean;
  indeterminate: boolean;
  /** False when this gate's configured `skipConditions` matched — it was never evaluated as pass/fail. */
  applicable: boolean;
  /** Human-readable reason shown when `applicable` is false, e.g. "Kuwaiti customer – Civil ID Status eligibility check not required". */
  skipReason?: string;
  reasonCode?: string;
  input: string;
  actualValue: unknown;
}

/**
 * Final Credit Limit = MIN(Tier Credit Limit, Segment Maximum, Global Maximum BNPL
 * Limit). The score determines the Decision Band, the Decision Band determines the
 * Tier, and the Tier's Credit Limit Rule (Segment + Tier → amount) is the only source of
 * the credit limit — Segment Maximum and Global Maximum only ever act as caps.
 */
export interface CreditLimitCalculation {
  tierCreditLimit: number | null;
  segmentMaxLimit: number;
  globalMaxLimit: number;
  finalLimit: number;
  /** True when an Approve decision assigned a Tier that has no configured Tier Credit Limit — a configuration error, never a silent 0 KWD. */
  configError?: boolean;
  configErrorReason?: string;
}

export interface DecisionResult {
  id: string;
  createdAt: string;
  configVersionId: string;
  configVersionLabel: string;
  customer: CustomerRecord;
  originalSegmentId: string;
  finalSegmentId: string;
  scoringModelId: string | null;
  hardGateResults: HardGateResult[];
  hardGateFailed: boolean;
  finalScore: number;
  decisionOutcome: DecisionOutcome;
  tier: string | null;
  creditLimit: number;
  creditLimitCalculation: CreditLimitCalculation | null;
  scoringBreakdown: ScoringBreakdownRow[];
  unavailableWeightPct: number;
  reasonCodes: string[];
  explanation: string;

  // Preapproved Marketing List — informational match plus the decision-floor effect.
  // decisionOutcome/tier/creditLimit above are always the FINAL (post-floor) values;
  // these two capture what the decision would have been without preapproval.
  originalDecisionOutcome: DecisionOutcome;
  originalTier: string | null;
  preapprovedMatchStatus: PreapprovedMatchStatus;
  preapprovedEntryId: string | null;
  preapprovedBatchId: string | null;
  preapprovedBatchName: string | null;
  preapprovedOverrideApplied: boolean;

  // CINET Score optionality — see engine/scoringEngine.ts. cinetScore/cinetStatus mirror
  // the resolved customer record for convenient, self-contained decision history records.
  assessmentType: AssessmentType;
  cinetStatus: CinetStatus;
  cinetScore: number | null;
  cinetIncludedInScore: boolean;
  /** field -> configured weight, for every enabled input in the scoring model used. */
  configuredScoringWeights: Record<string, number>;
  /** field -> effective weight actually used in this decision (excluded fields omitted). */
  effectiveScoringWeights: Record<string, number>;
}
