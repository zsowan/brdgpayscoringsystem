import { v4 as uuidv4 } from 'uuid';
import type { Configuration } from '../models/configuration';
import type { DecisionResult } from '../models/decision';
import type {
  AiAdvisorAuditRecord,
  AiAdvisorConfig,
  AiAdvisorRecommendation,
  AiConfidence,
  AiDecisionPackage,
  AiEligibilityRuleSummary,
  AiRecommendedAction,
} from '../models/aiAdvisor';
import { matchDecisionBand } from './creditLimitEngine';

const ALLOWED_ACTIONS: AiRecommendedAction[] = ['APPROVE', 'REJECT', 'REQUEST_MORE_INFORMATION'];
const ALLOWED_CONFIDENCE: AiConfidence[] = ['LOW', 'MEDIUM', 'HIGH'];
const CONFIDENCE_RANK: Record<AiConfidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export const AI_ADVISOR_PROMPT_VERSION = 'v1';

/**
 * The guardrail system prompt for a real LLM provider. The simulated provider (the
 * default, requiring no API key) is built to honor every one of these rules in code, so
 * behavior is identical in spirit regardless of which provider is configured.
 */
export const AI_ADVISOR_SYSTEM_PROMPT = `You are a credit manual-review assistant for BRDG Pay.

You analyze only the structured financial evidence supplied by the BRDG decision engine.
You do not invent missing information.
You do not override confirmed failed eligibility rules — you are only ever invoked for
cases already routed to Manual Review, never a confirmed Reject.
You do not use protected demographic attributes (gender, nationality, religion, ethnicity,
marital/family status, address-as-demographic-proxy) for credit risk recommendations —
none are included in the evidence you receive.
Any proposed credit limit must remain within the deterministic credit policy supplied to
you: MIN(applicable tier limit, segment maximum, global maximum).
Explain every recommendation using only the supplied scoring and eligibility evidence —
every positive or negative factor you cite must be traceable to the supplied data.
When evidence is insufficient or a material data point is missing, prefer
REQUEST_MORE_INFORMATION over guessing.

Respond with strict JSON only, matching this exact shape:
{
  "recommendedAction": "APPROVE" | "REJECT" | "REQUEST_MORE_INFORMATION",
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "recommendedTier": string | null,
  "recommendedLimitKwd": number | null,
  "summary": string,
  "positiveFactors": string[],
  "riskFactors": string[],
  "missingInformation": string[],
  "reasonCodes": string[],
  "recommendedActionReason": string
}`;

function isAiExcludedField(config: Configuration, fieldKey: string): boolean {
  return Boolean(config.customerFields.find((f) => f.key === fieldKey)?.aiExcluded);
}

/**
 * The AI Advisor exists only for genuine Manual Review cases produced by the
 * deterministic engine — never for an already-decided Approve or Reject. A confirmed
 * failed Hard Gate can only ever resolve to REJECT in this engine (see
 * decisionEngine.ts), so `!hardGateFailed` is guaranteed whenever `decisionOutcome ===
 * 'MANUAL_REVIEW'` already — checked again here defensively so this invariant is
 * enforced in exactly one place regardless of who calls it.
 */
export function shouldInvokeAiAdvisor(decision: DecisionResult): boolean {
  return decision.decisionOutcome === 'MANUAL_REVIEW' && !decision.hardGateFailed;
}

/** Builds the structured, PII-minimized, protected-attribute-free package sent to the AI. */
export function buildAiDecisionPackage(decision: DecisionResult, config: Configuration): AiDecisionPackage {
  const modelId = decision.scoringModelId;
  const bands = modelId ? config.decisionBands[modelId] ?? [] : [];
  const band = matchDecisionBand(bands, decision.finalScore);
  const decisionBandLabel = band ? `${(band.min * 100).toFixed(0)}-${(Math.min(1, band.max) * 100).toFixed(0)}%` : 'unknown';

  const eligibilityRules: AiEligibilityRuleSummary[] = decision.hardGateResults.map((g) => ({
    rule: g.name,
    result: !g.applicable ? 'NOT_APPLICABLE' : g.indeterminate ? 'UNAVAILABLE' : g.passed ? 'PASS' : 'FAIL',
  }));

  const scoringBreakdown = decision.scoringBreakdown
    .filter((r) => !isAiExcludedField(config, r.field))
    .map((r) => ({
      factor: r.displayName,
      rawValue: r.excluded || r.missing ? null : r.rawValue,
      normalizedScore: r.normalizedScore,
      weight: r.weight,
      contribution: Math.round(r.contribution * 10000) / 100,
      included: !r.excluded,
    }));

  const missingData = Array.from(new Set([
    ...decision.scoringBreakdown.filter((r) => (r.excluded || r.missing) && !isAiExcludedField(config, r.field)).map((r) => r.displayName),
    ...decision.hardGateResults.filter((g) => g.applicable && g.indeterminate).map((g) => g.name),
  ]));

  const creditRule = modelId ? config.creditLimitRules[modelId] : undefined;

  return {
    customerId: decision.id,
    segment: decision.originalSegmentId,
    engineResult: { score: decision.finalScore, decision: 'MANUAL_REVIEW', decisionBand: decisionBandLabel },
    eligibilityRules,
    scoringBreakdown,
    missingData,
    creditPolicy: {
      tierLimits: creditRule?.tiers ?? {},
      segmentMaximum: creditRule?.segmentMaximumKwd ?? 0,
      globalMaximum: config.globalSettings.globalMaxBnplLimit,
    },
    reasonCodes: decision.reasonCodes,
  };
}

function policyCeiling(pkg: AiDecisionPackage, tier: string | null): number {
  const tierLimit = tier ? pkg.creditPolicy.tierLimits[tier] : undefined;
  const candidates = [tierLimit, pkg.creditPolicy.segmentMaximum, pkg.creditPolicy.globalMaximum].filter(
    (v): v is number => typeof v === 'number'
  );
  return candidates.length > 0 ? Math.min(...candidates) : 0;
}

/**
 * Validates a raw AI response against the strict schema, then clamps any proposed credit
 * limit to the deterministic policy ceiling — the AI must never be able to exceed
 * configured policy, even if it tries to (CASE 5: a suggested limit above the global
 * maximum is clamped, never honored outright). A structurally invalid response (wrong
 * enum value, wrong types, unparseable) is rejected outright, not silently patched.
 */
export function validateAndClampAiResponse(
  raw: unknown,
  pkg: AiDecisionPackage
): { recommendation: AiAdvisorRecommendation; violations: string[] } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'AI response was not a JSON object.' };
  const r = raw as Record<string, unknown>;

  if (typeof r.recommendedAction !== 'string' || !ALLOWED_ACTIONS.includes(r.recommendedAction as AiRecommendedAction)) {
    return { error: `AI returned an unsupported recommendedAction: ${String(r.recommendedAction)}` };
  }
  if (typeof r.confidence !== 'string' || !ALLOWED_CONFIDENCE.includes(r.confidence as AiConfidence)) {
    return { error: `AI returned an unsupported confidence value: ${String(r.confidence)}` };
  }
  const stringArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

  let recommendedAction = r.recommendedAction as AiRecommendedAction;
  let recommendedTier = typeof r.recommendedTier === 'string' && r.recommendedTier ? r.recommendedTier : null;
  let recommendedLimitKwd = typeof r.recommendedLimitKwd === 'number' ? r.recommendedLimitKwd : null;
  const violations: string[] = [];

  if (recommendedAction === 'APPROVE') {
    if (!recommendedTier || !(recommendedTier in pkg.creditPolicy.tierLimits)) {
      violations.push(`AI recommended APPROVE without a valid configured Tier ("${recommendedTier ?? 'none'}") — downgraded to REQUEST_MORE_INFORMATION.`);
      recommendedAction = 'REQUEST_MORE_INFORMATION';
      recommendedTier = null;
      recommendedLimitKwd = null;
    } else {
      const ceiling = policyCeiling(pkg, recommendedTier);
      if (recommendedLimitKwd === null) {
        recommendedLimitKwd = ceiling;
      } else if (recommendedLimitKwd > ceiling) {
        violations.push(`AI recommended ${recommendedLimitKwd} KWD, exceeding the policy ceiling of ${ceiling} KWD — clamped.`);
        recommendedLimitKwd = ceiling;
      } else if (recommendedLimitKwd < 0) {
        violations.push('AI recommended a negative credit limit — clamped to 0.');
        recommendedLimitKwd = 0;
      }
    }
  } else {
    recommendedTier = null;
    recommendedLimitKwd = null;
  }

  const recommendation: AiAdvisorRecommendation = {
    recommendedAction,
    confidence: r.confidence as AiConfidence,
    recommendedTier,
    recommendedLimitKwd,
    summary: typeof r.summary === 'string' ? r.summary : '',
    positiveFactors: stringArray(r.positiveFactors),
    riskFactors: stringArray(r.riskFactors),
    missingInformation: stringArray(r.missingInformation),
    reasonCodes: stringArray(r.reasonCodes),
    recommendedActionReason: typeof r.recommendedActionReason === 'string' ? r.recommendedActionReason : '',
  };

  return { recommendation, violations };
}

const CRITICAL_UNAVAILABLE_RULES = new Set(['Current Delinquency', 'Civil ID Status']);

/**
 * A deterministic, fully-explainable stand-in for a real LLM — the default provider, so
 * the entire Manual Review Advisor flow (guardrails, clamping, audit trail, reviewer UI)
 * is testable and demoable with no external API key. Every factor cited is read directly
 * from the supplied decision package — nothing is invented, exactly as the system prompt
 * above requires. Runs through the identical `validateAndClampAiResponse` guardrail as a
 * real provider's response would, so both paths are provably held to the same policy.
 */
function runSimulatedAdvisor(pkg: AiDecisionPackage): AiAdvisorRecommendation {
  const positiveFactors: string[] = [];
  const riskFactors: string[] = [];

  for (const row of pkg.scoringBreakdown) {
    if (!row.included || row.normalizedScore === null) continue;
    if (row.normalizedScore >= 0.6) {
      positiveFactors.push(`${row.factor} was a positive contributor (normalized score ${row.normalizedScore.toFixed(2)}).`);
    } else if (row.normalizedScore < 0.4) {
      riskFactors.push(`${row.factor} was a weak contributor (normalized score ${row.normalizedScore.toFixed(2)}).`);
    }
  }

  const criticalMissing = pkg.eligibilityRules.filter((r) => r.result === 'UNAVAILABLE' && CRITICAL_UNAVAILABLE_RULES.has(r.rule));
  const missingInformation = Array.from(new Set([...pkg.missingData, ...criticalMissing.map((r) => r.rule)]));

  if (criticalMissing.length > 0) {
    const names = criticalMissing.map((r) => r.rule).join(' and ');
    return {
      recommendedAction: 'REQUEST_MORE_INFORMATION',
      confidence: 'MEDIUM',
      recommendedTier: null,
      recommendedLimitKwd: null,
      summary: `${names} could not be verified, which is a material credit-risk indicator that cannot be substituted with an assumption.`,
      positiveFactors,
      riskFactors: [...riskFactors, `${names} unavailable.`],
      missingInformation,
      reasonCodes: criticalMissing.map((r) => `${r.rule.toUpperCase().replace(/\s+/g, '_')}_UNAVAILABLE`),
      recommendedActionReason: `${names} ${criticalMissing.length > 1 ? 'are' : 'is'} unavailable — request the missing information before a decision can be made.`,
    };
  }

  const bandMatch = pkg.engineResult.decisionBand.match(/(\d+)-(\d+)%/);
  const bandMaxScore = bandMatch ? Number(bandMatch[2]) / 100 : null;
  const nearTopOfBand = bandMaxScore !== null && bandMaxScore - pkg.engineResult.score <= 0.02;
  const approveTierNames = Object.keys(pkg.creditPolicy.tierLimits);
  const lowestTier = approveTierNames[0];

  if (nearTopOfBand && riskFactors.length === 0 && missingInformation.length === 0 && lowestTier) {
    return {
      recommendedAction: 'APPROVE',
      confidence: 'MEDIUM',
      recommendedTier: lowestTier,
      recommendedLimitKwd: pkg.creditPolicy.tierLimits[lowestTier],
      summary: `Score ${(pkg.engineResult.score * 100).toFixed(1)}% is marginally below the automatic approval threshold, and verified financial indicators remain positive.`,
      positiveFactors: positiveFactors.length > 0 ? positiveFactors : ['No negative scoring factors were identified in the supplied evidence.'],
      riskFactors,
      missingInformation,
      reasonCodes: ['SCORE_MARGINALLY_BELOW_THRESHOLD'],
      recommendedActionReason: `Recommend approval at ${lowestTier} subject to reviewer confirmation.`,
    };
  }

  if (missingInformation.length > 0) {
    return {
      recommendedAction: 'REQUEST_MORE_INFORMATION',
      confidence: 'LOW',
      recommendedTier: null,
      recommendedLimitKwd: null,
      summary: `${missingInformation.join(', ')} ${missingInformation.length > 1 ? 'were' : 'was'} unavailable, which limits confidence in this assessment.`,
      positiveFactors,
      riskFactors,
      missingInformation,
      reasonCodes: ['INSUFFICIENT_VERIFIED_DATA'],
      recommendedActionReason: 'Additional verified financial data is needed before a confident recommendation can be made.',
    };
  }

  return {
    recommendedAction: 'REJECT',
    confidence: 'MEDIUM',
    recommendedTier: null,
    recommendedLimitKwd: null,
    summary: `Score ${(pkg.engineResult.score * 100).toFixed(1)}% falls in the lower part of the Manual Review band with no offsetting positive indicators.`,
    positiveFactors,
    riskFactors: riskFactors.length > 0 ? riskFactors : ['No positive scoring factors were strong enough to offset the low score.'],
    missingInformation,
    reasonCodes: ['SCORE_BELOW_ACCEPTABLE_RISK'],
    recommendedActionReason: 'Verified financial evidence does not support approval at this time.',
  };
}

/**
 * Real-provider call (Anthropic Messages API), used only when `provider: 'anthropic'` and
 * an API key is configured. Calls the provider directly from the browser — there is no
 * backend in this application — so the key is only ever sent to Anthropic's own API, but
 * it is still visible in this browser's LocalStorage and network traffic. This is
 * acceptable for local experimentation only, never for a production deployment handling
 * real customer data.
 */
async function callAnthropicProvider(pkg: AiDecisionPackage, cfg: AiAdvisorConfig, signal: AbortSignal): Promise<unknown> {
  const userPrompt = `Decision package (JSON):\n${JSON.stringify(pkg, null, 2)}\n\nRespond with the required JSON only, no other text.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxResponseTokens,
      temperature: cfg.temperature,
      system: AI_ADVISOR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`AI provider returned HTTP ${res.status}`);
  const data = await res.json();
  const text = (data as { content?: { text?: string }[] })?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('AI provider response had no text content.');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI provider response did not contain JSON.');
  return JSON.parse(jsonMatch[0]);
}

function manualReviewReason(decision: DecisionResult): string {
  const relevant = decision.reasonCodes.filter((c) => /MANUAL_REVIEW|UNAVAILABLE|INSUFFICIENT/.test(c));
  return relevant.length > 0 ? relevant.join(', ') : 'Score fell within the configured Manual Review band.';
}

/**
 * Orchestrates one AI Advisor invocation end to end: builds the package, calls the
 * configured provider under a timeout, validates and clamps the response to policy, and
 * returns a complete, ready-to-persist audit record. On ANY failure (timeout, network
 * error, invalid JSON, unsupported values) the case remains Manual Review — this function
 * never returns anything that could be mistaken for an automatic Approve/Reject.
 */
export async function runAiAdvisor(decision: DecisionResult, config: Configuration): Promise<AiAdvisorAuditRecord> {
  const pkg = buildAiDecisionPackage(decision, config);
  const aiConfig = config.aiAdvisor;
  const base = {
    id: uuidv4(),
    decisionId: decision.id,
    invokedAt: new Date().toISOString(),
    engineScore: decision.finalScore,
    engineManualReviewReason: manualReviewReason(decision),
    inputSnapshot: pkg,
    provider: aiConfig.provider,
    modelUsed: aiConfig.model,
    promptVersion: AI_ADVISOR_PROMPT_VERSION,
    policyViolations: [] as string[],
  };

  if (!shouldInvokeAiAdvisor(decision)) {
    return { ...base, status: 'NOT_APPLICABLE', recommendation: null };
  }
  if (!aiConfig.enabled) {
    return { ...base, status: 'DISABLED', recommendation: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), aiConfig.timeoutMs);
  try {
    const raw = aiConfig.provider === 'simulated' ? runSimulatedAdvisor(pkg) : await callAnthropicProvider(pkg, aiConfig, controller.signal);
    clearTimeout(timeout);

    const result = validateAndClampAiResponse(raw, pkg);
    if ('error' in result) {
      return { ...base, status: 'INVALID_RESPONSE', recommendation: null, errorMessage: result.error };
    }

    let recommendation = result.recommendation;
    const violations = [...result.violations];
    if (
      recommendation.recommendedAction === 'APPROVE' &&
      CONFIDENCE_RANK[recommendation.confidence] < CONFIDENCE_RANK[aiConfig.minConfidenceThreshold]
    ) {
      violations.push(`Confidence (${recommendation.confidence}) is below the configured minimum (${aiConfig.minConfidenceThreshold}) — downgraded to REQUEST_MORE_INFORMATION.`);
      recommendation = { ...recommendation, recommendedAction: 'REQUEST_MORE_INFORMATION', recommendedTier: null, recommendedLimitKwd: null };
    }

    return { ...base, status: 'OK', recommendation, policyViolations: violations };
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ...base,
      status: isAbort ? 'TIMEOUT' : 'ERROR',
      recommendation: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
