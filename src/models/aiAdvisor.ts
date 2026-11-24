// AI Manual Review Advisor — an advisory-only layer that runs ONLY for MANUAL_REVIEW
// decisions produced by the deterministic engine. It never approves, rejects, or sets a
// final credit limit itself; every recommendation requires explicit human confirmation
// (see storage/aiAdvisorStorage.ts and engine/aiAdvisorEngine.ts).

export type AiRecommendedAction = 'APPROVE' | 'REJECT' | 'REQUEST_MORE_INFORMATION';
export type AiConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type AiProvider = 'simulated' | 'anthropic';

export interface AiAdvisorConfig {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  temperature: number;
  maxResponseTokens: number;
  timeoutMs: number;
  minConfidenceThreshold: AiConfidence;
  /** Fixed for now — no autonomous final-decision mode exists. */
  recommendationMode: 'ADVISORY_ONLY';
  /** Only used by the 'anthropic' provider. Stored in LocalStorage like the rest of this
   *  demo's configuration — never sent anywhere except directly to the AI provider's own
   *  API from the browser. Not applicable to (and unused by) the 'simulated' provider. */
  apiKey?: string;
}

export interface AiEligibilityRuleSummary {
  rule: string;
  result: 'PASS' | 'FAIL' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
}

export interface AiScoringFactorSummary {
  factor: string;
  rawValue: unknown;
  normalizedScore: number | null;
  weight: number;
  /** Percentage points (0-100 scale), matching this app's existing display convention. */
  contribution: number;
  included: boolean;
}

export interface AiCreditPolicySummary {
  tierLimits: Record<string, number>;
  segmentMaximum: number;
  globalMaximum: number;
}

/**
 * The structured, minimized decision package handed to the AI. Deliberately excludes raw
 * customer identity/profile fields and every protected/demographic attribute (see
 * `CustomerDataField.aiExcluded` in models/configuration.ts) — the AI only ever sees the
 * financial/risk evidence the deterministic engine already produced.
 */
export interface AiDecisionPackage {
  customerId: string;
  segment: string;
  engineResult: { score: number; decision: 'MANUAL_REVIEW'; decisionBand: string };
  eligibilityRules: AiEligibilityRuleSummary[];
  scoringBreakdown: AiScoringFactorSummary[];
  missingData: string[];
  creditPolicy: AiCreditPolicySummary;
  reasonCodes: string[];
}

/** Strict, closed schema — no arbitrary free-form decision values are ever accepted. */
export interface AiAdvisorRecommendation {
  recommendedAction: AiRecommendedAction;
  confidence: AiConfidence;
  recommendedTier: string | null;
  recommendedLimitKwd: number | null;
  summary: string;
  positiveFactors: string[];
  riskFactors: string[];
  missingInformation: string[];
  reasonCodes: string[];
  recommendedActionReason: string;
}

export type AiAdvisorStatus =
  | 'OK'
  | 'TIMEOUT'
  | 'ERROR'
  | 'INVALID_RESPONSE'
  | 'DISABLED'
  | 'NOT_APPLICABLE';

export type ReviewerAction = 'ACCEPT' | 'OVERRIDE' | 'REQUEST_MORE_INFO';

export interface ReviewerFinalDecision {
  decision: 'APPROVE' | 'REJECT' | 'MANUAL_REVIEW';
  tier: string | null;
  limitKwd: number | null;
}

/**
 * One immutable record per AI invocation, keyed to the (also immutable) deterministic
 * DecisionResult it was invoked for. Reviewer fields are the only part ever appended to
 * after creation — the AI invocation fields (`inputSnapshot`, `recommendation`, etc.) are
 * never rewritten once recorded, and the original DecisionResult itself is never mutated.
 */
export interface AiAdvisorAuditRecord {
  id: string;
  decisionId: string;
  invokedAt: string;
  engineScore: number;
  engineManualReviewReason: string;
  inputSnapshot: AiDecisionPackage;
  provider: AiProvider;
  modelUsed: string;
  promptVersion: string;
  status: AiAdvisorStatus;
  recommendation: AiAdvisorRecommendation | null;
  /** Non-empty when the AI's raw response violated a guardrail (e.g. a limit above the
   *  policy ceiling) and was clamped/downgraded rather than rejected outright. */
  policyViolations: string[];
  errorMessage?: string;

  reviewerUserName?: string;
  reviewerAction?: ReviewerAction;
  reviewerFinalDecision?: ReviewerFinalDecision;
  reviewerOverrideReason?: string;
  reviewerActionAt?: string;
}
