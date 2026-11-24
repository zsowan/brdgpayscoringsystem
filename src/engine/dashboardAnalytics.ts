import type { Configuration } from '../models/configuration';
import type { DecisionResult } from '../models/decision';
import type { AiAdvisorAuditRecord, AiConfidence } from '../models/aiAdvisor';

// ============================================================
// Filters
// ============================================================

export interface DashboardFilters {
  dateFrom: string; // yyyy-mm-dd, '' = no lower bound
  dateTo: string; // yyyy-mm-dd, '' = no upper bound
  segmentId: string; // '' = all segments
  decision: 'ALL' | 'APPROVE' | 'MANUAL_REVIEW' | 'REJECT';
  tier: string; // '' = all tiers
  aiReviewStatus: 'ALL' | 'NOT_REVIEWED' | 'PENDING' | 'ACCEPTED' | 'OVERRIDDEN';
}

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = {
  dateFrom: '', dateTo: '', segmentId: '', decision: 'ALL', tier: '', aiReviewStatus: 'ALL',
};

/** A decision routed to a segment with no scoring model/credit line at all (e.g. a
 *  configured non-credit segment) — never counted toward BNPL approval/review/reject
 *  rates, tier distribution, or credit-limit analytics, since it never had a credit
 *  outcome to measure. Distinct from an age-prerequisite Reject, which never even
 *  reached a segment (`originalSegmentId === ''`) and IS a genuine BNPL outcome. */
export function isNonCreditRoute(d: DecisionResult): boolean {
  return d.originalSegmentId !== '' && d.scoringModelId === null;
}

/** A real, credit-bearing Approve — excludes a non-credit segment's incidental
 *  "APPROVE" outcome (which carries no tier and no real limit). */
export function isRealBnplApproval(d: DecisionResult): boolean {
  return d.decisionOutcome === 'APPROVE' && d.creditLimitCalculation !== null;
}

/** A decision where scoring actually ran (as opposed to a hard-gate reject before
 *  scoring, a non-credit segment, or an invalid scoring model) — its `finalScore` is a
 *  real computed value, not a placeholder 0. */
export function hasValidScore(d: DecisionResult): boolean {
  return d.scoringBreakdown.length > 0;
}

function inDateRange(iso: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function aiReviewStatusOf(decisionId: string, auditsByDecision: Map<string, AiAdvisorAuditRecord>): DashboardFilters['aiReviewStatus'] {
  const audit = auditsByDecision.get(decisionId);
  if (!audit || audit.status !== 'OK' || !audit.recommendation) return 'NOT_REVIEWED';
  if (audit.reviewerAction === 'ACCEPT') return 'ACCEPTED';
  if (audit.reviewerAction === 'OVERRIDE') return 'OVERRIDDEN';
  return 'PENDING';
}

export function filterDecisions(
  history: DecisionResult[],
  filters: DashboardFilters,
  auditsByDecision: Map<string, AiAdvisorAuditRecord>
): DecisionResult[] {
  return history.filter((d) => {
    if (!inDateRange(d.createdAt, filters.dateFrom, filters.dateTo)) return false;
    if (filters.segmentId && d.originalSegmentId !== filters.segmentId) return false;
    if (filters.decision !== 'ALL' && d.decisionOutcome !== filters.decision) return false;
    if (filters.tier && d.tier !== filters.tier) return false;
    if (filters.aiReviewStatus !== 'ALL' && aiReviewStatusOf(d.id, auditsByDecision) !== filters.aiReviewStatus) return false;
    return true;
  });
}

// ============================================================
// Reason code -> business-friendly label
// ============================================================

const REASON_CODE_LABELS: Record<string, string> = {
  UNDER_MINIMUM_AGE: 'Under Minimum Age',
  AGE_DATA_UNAVAILABLE: 'Age Data Unavailable',
  STUDENT_NATIONALITY_NOT_ELIGIBLE: 'Student Nationality Not Eligible',
  STUDENT_NATIONALITY_DATA_UNAVAILABLE: 'Student Nationality Data Unavailable',
  CURRENT_DELINQUENCY_DETECTED: 'Current Delinquency',
  CINET_DELINQUENCY_DATA_UNAVAILABLE: 'CINET Delinquency Data Unavailable',
  INVALID_CIVIL_ID: 'Invalid Civil ID Status',
  CIVIL_ID_STATUS_DATA_UNAVAILABLE: 'Civil ID Status Data Unavailable',
  DATA_UNAVAILABLE: 'Required Data Unavailable',
  HARD_GATE_DATA_UNAVAILABLE: 'Eligibility Data Unavailable',
  NO_CREDIT_SEGMENT: 'Routed to a Non-Credit Segment',
  SCORING_MODEL_INVALID: 'Scoring Model Misconfigured',
  INSUFFICIENT_VERIFIED_DATA: 'Insufficient Verified Data',
  MANUAL_REVIEW_REQUIRED_MISSING_DATA: 'Manual Review Required (Missing Data)',
  SCORE_ABOVE_THRESHOLD: 'Score Above Approval Threshold',
  SCORE_IN_REVIEW_BAND: 'Score In Manual Review Band',
  SCORE_BELOW_THRESHOLD: 'Score Below Approval Threshold',
  CREDIT_LIMIT_CONFIG_ERROR: 'Credit Limit Configuration Error',
  PREAPPROVED_MATCH_CIVIL_ID: 'Preapproved Match (Civil ID)',
  PREAPPROVED_MATCH_PHONE: 'Preapproved Match (Mobile)',
  PREAPPROVED_NOT_MATCHED: 'Not on Preapproved List',
  PREAPPROVED_BLOCKED_BY_HARD_GATE: 'Preapproval Blocked by Eligibility Failure',
  PREAPPROVED_ALREADY_APPROVED: 'Already Approved (Preapproval Not Needed)',
  PREAPPROVED_CONFIG_ERROR: 'Preapproval Configuration Error',
  PREAPPROVED_FLOOR_APPLIED: 'Preapproved Floor Applied',
};

/** Background/always-present codes that don't help explain WHY a decision came out the
 *  way it did — excluded from "Top Decision Reasons" so genuinely meaningful drivers
 *  aren't drowned out by a code present on nearly every decision. */
const NOISE_REASON_CODES = new Set(['PREAPPROVED_NOT_MATCHED', 'PREAPPROVED_ALREADY_APPROVED', 'SCORE_ABOVE_THRESHOLD']);

function titleCaseFromKey(key: string): string {
  return key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function fieldDisplayName(config: Configuration, fieldKeyUpper: string): string {
  const key = fieldKeyUpper.toLowerCase();
  return config.customerFields.find((f) => f.key === key)?.displayName ?? titleCaseFromKey(fieldKeyUpper);
}

/** Humanizes any reason code actually seen in decision history — a curated label for
 *  well-known codes, a field-aware label for the dynamic `MISSING_<FIELD>` /
 *  `<FIELD>_EXCLUDED_FROM_SCORING` patterns, and a generic Title Case fallback for any
 *  other admin-configured gate reason code. */
export function humanizeReasonCode(code: string, config: Configuration): string {
  if (REASON_CODE_LABELS[code]) return REASON_CODE_LABELS[code];
  const missingMatch = code.match(/^MISSING_(.+)$/);
  if (missingMatch) return `Missing ${fieldDisplayName(config, missingMatch[1])}`;
  const excludedMatch = code.match(/^(.+)_EXCLUDED_FROM_SCORING$/);
  if (excludedMatch) return `${fieldDisplayName(config, excludedMatch[1])} Unavailable (Excluded from Scoring)`;
  return titleCaseFromKey(code);
}

// ============================================================
// Segment display name (dynamic — never hardcoded)
// ============================================================

export function segmentLabel(config: Configuration, segmentId: string): string {
  if (!segmentId) return 'No Segment (Age Ineligible)';
  const seg = config.segments.find((s) => s.id === segmentId);
  return seg?.name ?? titleCaseFromKey(segmentId);
}

// ============================================================
// Aggregate stats
// ============================================================

export interface BucketItem { label: string; value: number; color?: string; }

export interface SegmentOutcomeRow { segmentId: string; label: string; approved: number; manualReview: number; rejected: number; total: number; }
export interface SegmentLimitRow { segmentId: string; label: string; avgLimit: number; count: number; }
export interface ReasonRow { code: string; label: string; count: number; }

export interface AiPerformanceStats {
  hasAnyAudits: boolean;
  totalManualReviewCases: number;
  reviewsRun: number;
  recommendedApprove: number;
  recommendedReject: number;
  recommendedMoreInfo: number;
  avgConfidenceLabel: AiConfidence | null;
  pendingConfirmation: number;
  accepted: number;
  overridden: number;
}

export interface DashboardStats {
  totalDecisions: number;
  nonCreditRouteCount: number;
  bnplDecisionCount: number;
  approvedCount: number;
  manualReviewCount: number;
  rejectedCount: number;
  approvalRate: number; // 0-100
  manualReviewRate: number;
  rejectRate: number;
  avgScore: number; // 0-1
  decisionsWithoutScore: number;
  avgApprovedLimit: number;
  funnel: { total: number; passedEligibility: number; scored: number; approved: number; manualReview: number; rejected: number };
  outcomeDistribution: BucketItem[];
  tierDistribution: BucketItem[];
  segmentBreakdown: SegmentOutcomeRow[];
  avgLimitBySegment: SegmentLimitRow[];
  creditLimitBuckets: BucketItem[];
  scoreBuckets: BucketItem[];
  topReasons: ReasonRow[];
  manualReviewReasons: ReasonRow[];
  ai: AiPerformanceStats;
}

const OUTCOME_COLORS = { APPROVE: '#12805c', MANUAL_REVIEW: '#b25e09', REJECT: '#b3261e' };
const TIER_COLORS = ['#2054c9', '#5b86e0', '#a9c4f5']; // Tier A, B, C (by position in whatever order the segment's own tiers appear)

const CONFIDENCE_RANK: Record<AiConfidence, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const CONFIDENCE_BY_RANK: AiConfidence[] = ['LOW', 'LOW', 'MEDIUM', 'HIGH']; // index by Math.round(avg)

export function computeDashboardStats(
  filtered: DecisionResult[],
  filteredAudits: AiAdvisorAuditRecord[],
  config: Configuration
): DashboardStats {
  const totalDecisions = filtered.length;
  const nonCredit = filtered.filter(isNonCreditRoute);
  const bnpl = filtered.filter((d) => !isNonCreditRoute(d));
  const bnplDecisionCount = bnpl.length;

  const approved = bnpl.filter((d) => d.decisionOutcome === 'APPROVE');
  const manualReview = bnpl.filter((d) => d.decisionOutcome === 'MANUAL_REVIEW');
  const rejected = bnpl.filter((d) => d.decisionOutcome === 'REJECT');

  const scored = bnpl.filter(hasValidScore);
  const avgScore = scored.length > 0 ? scored.reduce((s, d) => s + d.finalScore, 0) / scored.length : 0;

  const realApprovals = bnpl.filter(isRealBnplApproval);
  const avgApprovedLimit = realApprovals.length > 0 ? realApprovals.reduce((s, d) => s + d.creditLimit, 0) / realApprovals.length : 0;

  const passedEligibility = bnpl.filter((d) => !d.hardGateFailed).length;

  // --- Outcome distribution (Approved / Manual Review / Rejected only) ---
  const outcomeDistribution: BucketItem[] = [
    { label: 'Approved', value: approved.length, color: OUTCOME_COLORS.APPROVE },
    { label: 'Manual Review', value: manualReview.length, color: OUTCOME_COLORS.MANUAL_REVIEW },
    { label: 'Rejected', value: rejected.length, color: OUTCOME_COLORS.REJECT },
  ];

  // --- Approved Tier Distribution (real approvals only, tiers as actually configured — never hardcoded Tier A/B/C) ---
  const tierCounts = new Map<string, number>();
  realApprovals.forEach((d) => { if (d.tier) tierCounts.set(d.tier, (tierCounts.get(d.tier) ?? 0) + 1); });
  const tierDistribution: BucketItem[] = Array.from(tierCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: TIER_COLORS[i % TIER_COLORS.length] }));

  // --- Decisions by Segment (outcome breakdown, dynamic segment names) ---
  const segmentIds = Array.from(new Set(bnpl.map((d) => d.originalSegmentId)));
  const segmentBreakdown: SegmentOutcomeRow[] = segmentIds
    .map((segmentId) => {
      const rows = bnpl.filter((d) => d.originalSegmentId === segmentId);
      return {
        segmentId,
        label: segmentLabel(config, segmentId),
        approved: rows.filter((d) => d.decisionOutcome === 'APPROVE').length,
        manualReview: rows.filter((d) => d.decisionOutcome === 'MANUAL_REVIEW').length,
        rejected: rows.filter((d) => d.decisionOutcome === 'REJECT').length,
        total: rows.length,
      };
    })
    .sort((a, b) => b.total - a.total);

  // --- Average Approved Limit by Segment ---
  const avgLimitBySegment: SegmentLimitRow[] = segmentIds
    .map((segmentId) => {
      const rows = realApprovals.filter((d) => d.originalSegmentId === segmentId);
      return {
        segmentId,
        label: segmentLabel(config, segmentId),
        avgLimit: rows.length > 0 ? rows.reduce((s, d) => s + d.creditLimit, 0) / rows.length : 0,
        count: rows.length,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.avgLimit - a.avgLimit);

  // --- Credit Limit Distribution (5 buckets sized off the CURRENT Global Maximum) ---
  const globalMax = Math.max(1, config.globalSettings.globalMaxBnplLimit);
  const bucketWidth = Math.ceil(globalMax / 5);
  const creditLimitBuckets: BucketItem[] = Array.from({ length: 5 }, (_, i) => {
    const lo = i * bucketWidth + 1;
    const hi = i === 4 ? Math.max(globalMax, lo) : (i + 1) * bucketWidth;
    return { label: `${lo}–${hi} KWD`, value: 0 };
  });
  realApprovals.forEach((d) => {
    const idx = Math.min(4, Math.floor((d.creditLimit - 1) / bucketWidth));
    if (idx >= 0) creditLimitBuckets[idx].value += 1;
  });

  // --- Score Distribution (10 fixed 10-point buckets, scored decisions only) ---
  const scoreBuckets: BucketItem[] = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}–${i * 10 + 10}`, value: 0 }));
  scored.forEach((d) => {
    const idx = Math.min(9, Math.floor((d.finalScore * 100) / 10));
    scoreBuckets[idx].value += 1;
  });
  const decisionsWithoutScore = bnpl.length - scored.length;

  // --- Top Decision Reasons (all BNPL decisions, noise codes excluded) ---
  const reasonCounts = new Map<string, number>();
  bnpl.forEach((d) => d.reasonCodes.forEach((code) => {
    if (NOISE_REASON_CODES.has(code)) return;
    reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
  }));
  const topReasons: ReasonRow[] = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([code, count]) => ({ code, label: humanizeReasonCode(code, config), count }));

  // --- Manual Review Reasons (buckets, a decision may contribute to more than one) ---
  const auditsByDecision = new Map(filteredAudits.map((a) => [a.decisionId, a]));
  const mrReasonCounts = new Map<string, number>();
  const bump = (label: string) => mrReasonCounts.set(label, (mrReasonCounts.get(label) ?? 0) + 1);
  manualReview.forEach((d) => {
    const codes = d.reasonCodes;
    const hasInsufficientData = codes.includes('INSUFFICIENT_VERIFIED_DATA');
    const hasManualReviewFactor = codes.includes('MANUAL_REVIEW_REQUIRED_MISSING_DATA');
    const hasHardGateUnavailable = codes.includes('HARD_GATE_DATA_UNAVAILABLE');
    const hasInvalidModel = codes.includes('SCORING_MODEL_INVALID');
    if (hasHardGateUnavailable) bump('Hard Gate Data Unavailable');
    if (hasInsufficientData) bump('Insufficient Verified Data');
    if (hasManualReviewFactor) bump('Manual Review Required (Missing Factor)');
    if (hasInvalidModel) bump('Scoring Model Misconfigured');
    if (codes.some((c) => c.includes('CINET'))) bump('CINET Data Unavailable');
    if (!hasInsufficientData && !hasManualReviewFactor && !hasHardGateUnavailable && !hasInvalidModel) bump('Score In Manual Review Band');
    const audit = auditsByDecision.get(d.id);
    if (audit?.status === 'OK' && audit.recommendation?.recommendedAction === 'REQUEST_MORE_INFORMATION') bump('AI Requested More Information');
  });
  const manualReviewReasons: ReasonRow[] = Array.from(mrReasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ code: label, label, count }));

  // --- AI Manual Review Performance ---
  const successfulAudits = filteredAudits.filter((a) => a.status === 'OK' && a.recommendation);
  const confidenceValues = successfulAudits.map((a) => CONFIDENCE_RANK[a.recommendation!.confidence]);
  const avgConfidenceRank = confidenceValues.length > 0 ? confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length : 0;
  const ai: AiPerformanceStats = {
    hasAnyAudits: filteredAudits.length > 0,
    totalManualReviewCases: manualReview.length,
    reviewsRun: filteredAudits.length,
    recommendedApprove: successfulAudits.filter((a) => a.recommendation!.recommendedAction === 'APPROVE').length,
    recommendedReject: successfulAudits.filter((a) => a.recommendation!.recommendedAction === 'REJECT').length,
    recommendedMoreInfo: successfulAudits.filter((a) => a.recommendation!.recommendedAction === 'REQUEST_MORE_INFORMATION').length,
    avgConfidenceLabel: confidenceValues.length > 0 ? CONFIDENCE_BY_RANK[Math.round(avgConfidenceRank)] : null,
    pendingConfirmation: successfulAudits.filter((a) => !a.reviewerAction).length,
    accepted: filteredAudits.filter((a) => a.reviewerAction === 'ACCEPT').length,
    overridden: filteredAudits.filter((a) => a.reviewerAction === 'OVERRIDE').length,
  };

  return {
    totalDecisions,
    nonCreditRouteCount: nonCredit.length,
    bnplDecisionCount,
    approvedCount: approved.length,
    manualReviewCount: manualReview.length,
    rejectedCount: rejected.length,
    approvalRate: bnplDecisionCount > 0 ? (approved.length / bnplDecisionCount) * 100 : 0,
    manualReviewRate: bnplDecisionCount > 0 ? (manualReview.length / bnplDecisionCount) * 100 : 0,
    rejectRate: bnplDecisionCount > 0 ? (rejected.length / bnplDecisionCount) * 100 : 0,
    avgScore,
    decisionsWithoutScore,
    avgApprovedLimit,
    funnel: {
      total: bnplDecisionCount,
      passedEligibility,
      scored: scored.length,
      approved: approved.length,
      manualReview: manualReview.length,
      rejected: rejected.length,
    },
    outcomeDistribution,
    tierDistribution,
    segmentBreakdown,
    avgLimitBySegment,
    creditLimitBuckets,
    scoreBuckets,
    topReasons,
    manualReviewReasons,
    ai,
  };
}
