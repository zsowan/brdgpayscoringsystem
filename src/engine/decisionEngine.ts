import { v4 as uuidv4 } from 'uuid';
import type { Configuration, DecisionBandDef, DecisionOutcome, HardGateRule } from '../models/configuration';
import type { CustomerRecord } from '../models/customer';
import type { DecisionResult, HardGateResult, ScoringBreakdownRow } from '../models/decision';
import type { PreapprovedEntry, PreapprovedFloorResult, PreapprovedMatchResult } from '../models/preapproved';
import type { AssessmentType, CinetStatus } from '../models/cinet';
import { evaluateConditions, evaluateOperator } from './ruleEngine';
import { routeCustomer } from './routingEngine';
import { computeScore } from './scoringEngine';
import { isModelValid } from './normalization';
import { computeCreditLimit, getTierCreditLimit, matchDecisionBand, DEFAULT_DATA_UNAVAILABLE_REASON_CODE } from './creditLimitEngine';
import {
  applyPreapprovedDecisionFloor,
  findPreapprovedMatch,
  getLowestApprovedBand,
  getVerifiedCivilId,
  matchStatusReasonCode,
} from './preapprovedEngine';

const MINIMUM_AGE_GATE_ID = 'gate_min_age';

function isUnavailable(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Applies hard gates in priority order against the customer record.
 *
 * Segment routing happens first, so this only ever runs against the gates applicable to
 * the customer's already-determined segment: a gate with `onlySegments` set ("Applies To
 * Segments") is filtered out entirely (never shown, never evaluated) for every other
 * segment, since it's a segment-specific eligibility rule (e.g. Student Nationality).
 * Empty/absent `onlySegments` means the gate applies to every segment.
 *
 * A gate whose `skipConditions` all match the customer (e.g. Civil ID Status is not an
 * eligibility condition for Kuwaiti nationals) is never evaluated at all — it is neither
 * passed, failed, nor indeterminate, only marked Not Applicable, so the audit trail never
 * shows a gate as "Passed" when it was in fact never checked.
 *
 * A gate whose input is unavailable (e.g. an integration timed out) is marked
 * indeterminate rather than failed — a system outage should route to manual review,
 * not silently masquerade as a confirmed hard-gate breach.
 */
function applyHardGates(gates: HardGateRule[], data: CustomerRecord, segmentId: string): HardGateResult[] {
  return [...gates]
    .filter((g) => g.enabled)
    .filter((g) => !g.onlySegments || g.onlySegments.length === 0 || g.onlySegments.includes(segmentId))
    .sort((a, b) => a.priority - b.priority)
    .map((gate) => {
      const actualValue = data[gate.input];
      if (gate.skipConditions && gate.skipConditions.length > 0 && evaluateConditions(gate.skipConditions, data)) {
        return {
          ruleId: gate.id,
          name: gate.name,
          passed: true,
          indeterminate: false,
          applicable: false,
          skipReason: gate.skipDescription ?? 'This gate does not apply to this customer.',
          reasonCode: undefined,
          input: gate.input,
          actualValue: actualValue ?? null,
        };
      }
      const indeterminate = gate.operator !== 'is_null' && gate.operator !== 'is_not_null' && isUnavailable(actualValue);
      const passed = indeterminate ? true : evaluateOperator(gate.operator, actualValue, gate.value);
      // A gate with no custom unavailable-data reason code configured still must never be
      // silently marked Pass or Fail when its data is missing — it falls back to a generic,
      // always-present reason code instead of leaving the indeterminate case unexplained.
      const reasonCode = !passed ? gate.reasonCode : indeterminate ? (gate.dataUnavailableReasonCode || DEFAULT_DATA_UNAVAILABLE_REASON_CODE) : undefined;
      return {
        ruleId: gate.id,
        name: gate.name,
        passed,
        indeterminate,
        applicable: true,
        reasonCode,
        input: gate.input,
        actualValue: actualValue ?? null,
      };
    });
}

/** Common preapproved-related fields shared by every DecisionResult return branch. */
function preapprovedFields(matchResult: PreapprovedMatchResult, floorResult: PreapprovedFloorResult) {
  return {
    preapprovedMatchStatus: matchResult.status,
    preapprovedEntryId: matchResult.entry?.id ?? null,
    preapprovedBatchId: matchResult.entry?.batchId ?? null,
    preapprovedBatchName: matchResult.entry?.batchName ?? null,
    preapprovedOverrideApplied: floorResult.applied,
  };
}

function preapprovedReasonCodes(matchResult: PreapprovedMatchResult, floorResult: PreapprovedFloorResult): string[] {
  const codes = [matchStatusReasonCode(matchResult.status)];
  if (floorResult.reasonCode) codes.push(floorResult.reasonCode);
  return codes;
}

/** CINET Score optionality + weight-transparency fields, shared by every DecisionResult return branch. */
function cinetAndWeightFields(customer: CustomerRecord, rows: ScoringBreakdownRow[]) {
  const cinetStatus: CinetStatus = (customer.cinet_status as CinetStatus) ?? 'NOT_CHECKED';
  const assessmentType: AssessmentType = cinetStatus === 'AVAILABLE' ? 'full' : 'preliminary';
  const cinetScore = (customer.cinet_score as number | null | undefined) ?? null;
  const cinetRow = rows.find((r) => r.field === 'cinet_score');
  const cinetIncludedInScore = Boolean(cinetRow && !cinetRow.excluded);

  const configuredScoringWeights: Record<string, number> = {};
  const effectiveScoringWeights: Record<string, number> = {};
  for (const row of rows) {
    configuredScoringWeights[row.field] = row.weight;
    if (!row.excluded && row.effectiveWeight !== null) effectiveScoringWeights[row.field] = row.effectiveWeight;
  }

  return { assessmentType, cinetStatus, cinetScore, cinetIncludedInScore, configuredScoringWeights, effectiveScoringWeights };
}

export function runDecisionEngine(
  config: Configuration,
  customer: CustomerRecord,
  preapprovedEntries: PreapprovedEntry[] = []
): DecisionResult {
  // 1. Customer Input / 2. PACI Identity Verification — already resolved into `customer` by the caller.
  // Preapproved List Match Detection — uses the mock-verified civil ID, never the raw typed one.
  const verifiedCivilId = getVerifiedCivilId(customer);
  const matchResult = findPreapprovedMatch(verifiedCivilId, customer.mobile_number, preapprovedEntries);
  const policyEnabled = config.preapprovedMarketing.enabled;
  const cinetWeightFields = cinetAndWeightFields(customer, []);

  // Minimum Age is a prerequisite for the whole BNPL assessment, not just another hard
  // gate: an ineligible customer never gets a segment, never gets scored, and preapproval
  // can never bypass it. Evaluated before routing/segmentation for exactly that reason.
  const minAgeGate = config.hardGates.find((g) => g.id === MINIMUM_AGE_GATE_ID && g.enabled);
  if (minAgeGate) {
    const actualValue = customer[minAgeGate.input];
    const indeterminate = isUnavailable(actualValue);
    const passed = indeterminate ? true : evaluateOperator(minAgeGate.operator, actualValue, minAgeGate.value);
    if (!passed) {
      const gateResult: HardGateResult = {
        ruleId: minAgeGate.id, name: minAgeGate.name, passed: false, indeterminate: false, applicable: true,
        reasonCode: minAgeGate.reasonCode, input: minAgeGate.input, actualValue: actualValue ?? null,
      };
      const floorResult = applyPreapprovedDecisionFloor({
        policyEnabled, matchResult, hardGatePassed: false, segmentId: '', originalDecision: 'REJECT', originalTier: null, decisionBands: [],
      });
      const reasonCodes = [minAgeGate.reasonCode, ...preapprovedReasonCodes(matchResult, floorResult)];

      return {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        configVersionId: config.id,
        configVersionLabel: config.versionLabel,
        customer,
        originalSegmentId: '',
        finalSegmentId: '',
        scoringModelId: null,
        hardGateResults: [gateResult],
        hardGateFailed: true,
        finalScore: 0,
        decisionOutcome: 'REJECT',
        tier: null,
        creditLimit: 0,
        creditLimitCalculation: null,
        scoringBreakdown: [],
        unavailableWeightPct: 0,
        reasonCodes,
        originalDecisionOutcome: 'REJECT',
        originalTier: null,
        ...preapprovedFields(matchResult, floorResult),
        ...cinetWeightFields,
        explanation: `Customer is not eligible for a BNPL credit assessment: ${minAgeGate.name} failed (age ${actualValue ?? 'unknown'}). No segment, scoring, or credit decision was produced.`,
      };
    }
  }

  // Age-based segment routing — only reached once minimum-age eligibility is confirmed.
  const routing = routeCustomer(config, customer);
  const originalSegmentId = routing.segmentId;
  const originalSegment = config.segments.find((s) => s.id === originalSegmentId);

  // Eligibility / hard gates (segment-based exemptions remain supported generically,
  // though no default gate currently uses one). Preapproval can never bypass these.
  const hardGateResults = applyHardGates(config.hardGates, customer, originalSegmentId);
  const hardGateFailed = hardGateResults.some((r) => r.applicable && !r.passed);
  const hardGateIndeterminate = hardGateResults.some((r) => r.applicable && r.indeterminate);
  const hardGatePassed = !hardGateFailed;

  const scoringModelId = originalSegment?.scoringModelId ?? null;
  const finalSegmentId = originalSegmentId;

  const reasonCodes: string[] = [];
  hardGateResults.forEach((r) => {
    if (!r.passed && r.reasonCode) reasonCodes.push(r.reasonCode);
    if (r.indeterminate && r.reasonCode) reasonCodes.push(r.reasonCode);
  });
  if (hardGateIndeterminate) reasonCodes.push('HARD_GATE_DATA_UNAVAILABLE');

  // Defensive fallback: every current segment carries a scoring model, but a
  // misconfiguration (or hard-gate rejection) can still leave scoringModelId unset.
  if (hardGateFailed || !scoringModelId) {
    const originalDecisionOutcome: DecisionOutcome = hardGateFailed ? 'REJECT' : hardGateIndeterminate ? 'MANUAL_REVIEW' : 'APPROVE';
    if (!hardGateFailed && !scoringModelId && originalDecisionOutcome === 'APPROVE') reasonCodes.push('NO_CREDIT_SEGMENT');

    const floorResult = applyPreapprovedDecisionFloor({
      policyEnabled,
      matchResult,
      hardGatePassed,
      segmentId: originalSegmentId,
      originalDecision: originalDecisionOutcome,
      originalTier: null,
      decisionBands: scoringModelId ? config.decisionBands[scoringModelId] ?? [] : [],
    });
    reasonCodes.push(...preapprovedReasonCodes(matchResult, floorResult));

    return {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      configVersionId: config.id,
      configVersionLabel: config.versionLabel,
      customer,
      originalSegmentId,
      finalSegmentId,
      scoringModelId,
      hardGateResults,
      hardGateFailed,
      finalScore: 0,
      decisionOutcome: originalDecisionOutcome,
      tier: null,
      // No scoring model means no tier is ever determined, so there is no principled
      // credit limit to grant — a segment with no scoring model simply carries no credit line.
      creditLimit: 0,
      creditLimitCalculation: null,
      scoringBreakdown: [],
      unavailableWeightPct: 0,
      reasonCodes,
      originalDecisionOutcome,
      originalTier: null,
      ...preapprovedFields(matchResult, floorResult),
      ...cinetWeightFields,
      explanation: hardGateFailed
        ? `Rejected: failed hard gate(s) ${hardGateResults.filter((r) => !r.passed).map((r) => r.name).join(', ')}.${matchResult.status !== 'not_matched' ? ' Preapproved marketing status cannot override a hard-gate rejection.' : ''}`
        : hardGateIndeterminate
        ? `Routed to ${originalSegment?.name ?? originalSegmentId}, but one or more hard gates could not be verified (data unavailable) — sent to manual review.`
        : `Routed to ${originalSegment?.name ?? originalSegmentId}, which does not carry a credit line.`,
    };
  }

  // Unified scoring — load scoring model, normalize available inputs, weight and sum.
  const model = config.scoringModels[scoringModelId];
  const modelValid = isModelValid(model.inputs);

  if (!modelValid) {
    const originalDecisionOutcome: DecisionOutcome = 'MANUAL_REVIEW';
    const decisionBands = config.decisionBands[scoringModelId] ?? [];
    const floorResult = applyPreapprovedDecisionFloor({
      policyEnabled,
      matchResult,
      hardGatePassed,
      segmentId: originalSegmentId,
      originalDecision: originalDecisionOutcome,
      originalTier: null,
      decisionBands,
    });
    reasonCodes.push('SCORING_MODEL_INVALID', ...preapprovedReasonCodes(matchResult, floorResult));

    const finalBand = floorResult.applied ? getLowestApprovedBand(decisionBands) : null;
    const creditLimitCalculation =
      floorResult.decisionOutcome === 'APPROVE'
        ? computeCreditLimit(
            getTierCreditLimit(config.creditLimitRules, scoringModelId, finalBand?.tier),
            config.creditLimitRules[scoringModelId]?.segmentMaximumKwd ?? 0,
            config.globalSettings.globalMaxBnplLimit,
            finalBand?.tier
          )
        : null;
    if (creditLimitCalculation?.configError) reasonCodes.push('CREDIT_LIMIT_CONFIG_ERROR');

    return {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      configVersionId: config.id,
      configVersionLabel: config.versionLabel,
      customer,
      originalSegmentId,
      finalSegmentId,
      scoringModelId,
      hardGateResults,
      hardGateFailed,
      finalScore: 0,
      decisionOutcome: floorResult.decisionOutcome,
      tier: floorResult.tier,
      creditLimit: creditLimitCalculation?.finalLimit ?? 0,
      creditLimitCalculation,
      scoringBreakdown: [],
      unavailableWeightPct: 0,
      reasonCodes,
      originalDecisionOutcome,
      originalTier: null,
      ...preapprovedFields(matchResult, floorResult),
      ...cinetWeightFields,
      explanation: `Scoring model "${model.name}" has enabled weights that do not total 100% and is disabled — routed to manual review.${floorResult.applied ? ` Preapproved marketing status promoted the decision to ${floorResult.tier}.` : ''}`,
    };
  }

  const { rows, finalScore, unavailableWeightPct, manualReviewTriggered } = computeScore(model, customer);
  const cinetFields = cinetAndWeightFields(customer, rows);

  // Insufficient verified data (factors still using a null-default fallback, NOT
  // excluded ones like an unchecked CINET score) forces manual review.
  const missingDataTriggered = unavailableWeightPct > config.globalSettings.manualReviewMissingWeightThreshold;
  if (missingDataTriggered) reasonCodes.push('INSUFFICIENT_VERIFIED_DATA');
  if (manualReviewTriggered) reasonCodes.push('MANUAL_REVIEW_REQUIRED_MISSING_DATA');

  // Decision Band Match.
  const bands = config.decisionBands[scoringModelId] ?? [];
  const band = matchDecisionBand(bands, finalScore);
  let originalDecisionOutcome: DecisionOutcome = band?.outcome ?? 'MANUAL_REVIEW';
  if ((missingDataTriggered || manualReviewTriggered || hardGateIndeterminate) && originalDecisionOutcome === 'APPROVE') originalDecisionOutcome = 'MANUAL_REVIEW';
  // A Tier is only ever meaningful alongside an Approve outcome — if the band's raw
  // Approve/Tier match got overridden to Manual Review above (missing data, a factor
  // configured for manual review, or an indeterminate hard gate), the Tier must be
  // cleared too. Otherwise the UI could show "Tier C" and "Manual Review" as two
  // simultaneous authoritative outcomes for the same decision, which is never correct.
  const originalTier = originalDecisionOutcome === 'APPROVE' ? band?.tier ?? null : null;

  rows.forEach((r) => {
    if (r.excluded) {
      reasonCodes.push(`${r.field.toUpperCase()}_EXCLUDED_FROM_SCORING`);
    } else if (r.missing) {
      reasonCodes.push(`MISSING_${r.field.toUpperCase()}`);
    }
  });
  if (originalDecisionOutcome === 'APPROVE') reasonCodes.push('SCORE_ABOVE_THRESHOLD');
  if (originalDecisionOutcome === 'MANUAL_REVIEW' && !missingDataTriggered) reasonCodes.push('SCORE_IN_REVIEW_BAND');
  if (originalDecisionOutcome === 'REJECT') reasonCodes.push('SCORE_BELOW_THRESHOLD');

  // Preapproved Marketing Decision Override — applied only AFTER the band match above.
  const floorResult = applyPreapprovedDecisionFloor({
    policyEnabled,
    matchResult,
    hardGatePassed,
    segmentId: originalSegmentId,
    originalDecision: originalDecisionOutcome,
    originalTier,
    decisionBands: bands,
  });
  reasonCodes.push(...preapprovedReasonCodes(matchResult, floorResult));

  const finalDecisionOutcome = floorResult.decisionOutcome;
  const finalTier = floorResult.tier;
  const effectiveBand: DecisionBandDef | null = floorResult.applied ? getLowestApprovedBand(bands) : band;

  // Credit limit = MIN(Tier Credit Limit, Segment Maximum, Global Maximum BNPL Limit),
  // fed the (possibly floor-promoted) band's tier. Never derived from income or any other formula.
  const creditLimitCalculation =
    finalDecisionOutcome === 'APPROVE'
      ? computeCreditLimit(
          getTierCreditLimit(config.creditLimitRules, scoringModelId, effectiveBand?.tier),
          config.creditLimitRules[scoringModelId]?.segmentMaximumKwd ?? 0,
          config.globalSettings.globalMaxBnplLimit,
          effectiveBand?.tier
        )
      : null;
  const creditLimit = creditLimitCalculation?.finalLimit ?? 0;
  if (creditLimitCalculation?.configError) reasonCodes.push('CREDIT_LIMIT_CONFIG_ERROR');

  const explanation = buildExplanation({
    segmentName: originalSegment?.name ?? originalSegmentId,
    finalScore,
    decisionOutcome: finalDecisionOutcome,
    tier: finalTier,
    creditLimit,
    missingDataTriggered,
    manualReviewTriggered,
    floorResult,
    cinetIncludedInScore: cinetFields.cinetIncludedInScore,
    cinetStatus: cinetFields.cinetStatus,
  });

  return {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    configVersionId: config.id,
    configVersionLabel: config.versionLabel,
    customer,
    originalSegmentId,
    finalSegmentId,
    scoringModelId,
    hardGateResults,
    hardGateFailed,
    finalScore,
    decisionOutcome: finalDecisionOutcome,
    tier: finalTier,
    creditLimit,
    creditLimitCalculation,
    scoringBreakdown: rows,
    unavailableWeightPct,
    reasonCodes,
    originalDecisionOutcome,
    originalTier,
    ...preapprovedFields(matchResult, floorResult),
    ...cinetFields,
    explanation,
  };
}

function buildExplanation(args: {
  segmentName: string;
  finalScore: number;
  decisionOutcome: string;
  tier: string | null;
  creditLimit: number;
  missingDataTriggered: boolean;
  manualReviewTriggered: boolean;
  floorResult: PreapprovedFloorResult;
  cinetIncludedInScore: boolean;
  cinetStatus: CinetStatus;
}): string {
  const parts: string[] = [];
  parts.push(`Customer routed to segment "${args.segmentName}".`);
  if (!args.cinetIncludedInScore) {
    parts.push('CINET Score was not available and was excluded from this assessment. Remaining available scoring factors were re-weighted proportionally.');
  }
  parts.push(`Weighted score calculated at ${(args.finalScore * 100).toFixed(1)} / 100.`);
  if (args.manualReviewTriggered) {
    parts.push('A factor configured for Manual Review was unavailable, so a human underwriter must confirm this decision regardless of score.');
  }
  if (args.missingDataTriggered) {
    parts.push('Too much of the remaining scoring data relied on unavailable fallback values, so the decision was routed to manual review.');
  } else if (args.decisionOutcome === 'APPROVE' && !args.floorResult.applied) {
    parts.push(`Score falls in an approve band (${args.tier ?? 'n/a'}), final credit limit set to ${args.creditLimit} KWD.`);
  } else if (args.decisionOutcome === 'MANUAL_REVIEW') {
    parts.push('Score falls in the manual review band — a human underwriter should confirm the decision.');
  } else if (args.decisionOutcome === 'REJECT') {
    parts.push('Score falls below the minimum approve threshold, application rejected.');
  }
  if (args.floorResult.applied) {
    parts.push(`This customer matched the Preapproved Marketing List, so BRDG Pay promoted the decision to the lowest configured approve tier (${args.tier ?? 'n/a'}), with credit limit still set to ${args.creditLimit} KWD by the normal segment and global limits.`);
  } else if (args.floorResult.reasonCode === 'PREAPPROVED_ALREADY_APPROVED') {
    parts.push('This customer also matched the Preapproved Marketing List, but was already approved by normal scoring — no promotion was needed.');
  }
  return parts.join(' ');
}
