import { v4 as uuidv4 } from 'uuid';
import type {
  Configuration,
  Condition,
  RoutingRule,
  Segment,
} from '../models/configuration';
import type { DecisionResult } from '../models/decision';
import { bandsFor } from '../data/defaultConfig';
import { isModelValid, totalWeight } from './normalization';
import { validateBandCoverage, validateBandTiers, validateCreditLimitRule, validateHardGate } from './creditLimitEngine';

/**
 * Segment routing is configured directly on each Segment (`ageMin`/`ageMax` for
 * `routingMode: 'AGE_RANGE'`) — this is the ONLY place an administrator edits it. This
 * function is the sole place `RoutingRule[]` is ever produced; the storage layer calls it
 * unconditionally on every load so `config.routingRules` can never drift out of sync with
 * the segments it's derived from. `routingEngine.ts` itself is untouched — it still just
 * evaluates whatever `RoutingRule[]` it's handed.
 *
 * `ADVANCED`-mode segments are skipped entirely (no rule is generated) until an
 * advanced-condition routing mode is implemented.
 */
export function buildRoutingRulesFromSegments(segments: Segment[]): RoutingRule[] {
  return [...segments]
    .filter((s) => s.active && s.routingMode === 'AGE_RANGE')
    .sort((a, b) => a.priority - b.priority)
    .map((s) => {
      const conditions: Condition[] = [];
      if (s.ageMin !== undefined) conditions.push({ field: 'age', operator: 'gte', value: s.ageMin });
      if (s.ageMax !== undefined) conditions.push({ field: 'age', operator: 'lte', value: s.ageMax });
      return {
        id: `route_${s.id}`,
        priority: s.priority,
        enabled: true,
        conditions,
        targetSegmentId: s.id,
        description: `${describeAgeRange(s)} → ${s.name}`,
        isCatchAll: s.ageMax === undefined,
      };
    });
}

function describeAgeRange(s: Segment): string {
  if (s.ageMin === undefined && s.ageMax === undefined) return 'Any age';
  if (s.ageMax === undefined) return `${s.ageMin}+`;
  return `${s.ageMin ?? 0}–${s.ageMax}`;
}

/**
 * Simple Age Range routing must never let two active segments silently compete for the
 * same customer, and must never leave an age silently unrouted. Priority-based
 * intentional overlap isn't supported yet, so any overlap between two active
 * `AGE_RANGE` segments is always an error, not a judgment call.
 */
export function validateSegmentRouting(segments: Segment[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const ranged = segments.filter((s) => s.active && s.routingMode === 'AGE_RANGE');

  for (const s of ranged) {
    if (s.ageMin !== undefined && s.ageMax !== undefined && s.ageMin > s.ageMax) {
      issues.push(`"${s.name}": Minimum Age (${s.ageMin}) must be <= Maximum Age (${s.ageMax}).`);
    }
  }

  const sorted = [...ranged].sort((a, b) => (a.ageMin ?? 0) - (b.ageMin ?? 0));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const aMin = a.ageMin ?? 0;
      const aMax = a.ageMax ?? Infinity;
      const bMin = b.ageMin ?? 0;
      const bMax = b.ageMax ?? Infinity;
      if (aMin <= bMax && bMin <= aMax) {
        issues.push(`"${a.name}" (${describeAgeRange(a)}) age range overlaps with "${b.name}" (${describeAgeRange(b)}).`);
      }
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.ageMax !== undefined && cur.ageMin !== undefined && cur.ageMin > prev.ageMax + 1) {
      issues.push(`Gap in age coverage between "${prev.name}" (up to ${prev.ageMax}) and "${cur.name}" (from ${cur.ageMin}) — ages ${prev.ageMax + 1}–${cur.ageMin - 1} are not routed to any active segment.`);
    }
  }

  return { valid: issues.length === 0, issues };
}

export type SegmentConfigStatus = 'READY' | 'INCOMPLETE' | 'INVALID';

/** Badge class per status — shared by SegmentsPage and DecisionEnginePage so the same status always renders identically. */
export const SEGMENT_STATUS_BADGE_CLASS: Record<SegmentConfigStatus, string> = {
  READY: 'badge-approve',
  INCOMPLETE: 'badge-review',
  INVALID: 'badge-reject',
};

/**
 * READY requires valid routing, valid Eligibility Rules, a scoring model whose enabled
 * weights total exactly 100%, valid Decision Bands, and valid Credit Limits (including
 * Segment Maximum <= Global Maximum). A segment that simply hasn't been filled in yet
 * (no scoring factors, no bands, or all-zero credit limits) is INCOMPLETE rather than
 * INVALID — that's the expected state right after creating a segment, not an error.
 * Any segment with a genuine problem (bad routing, an incomplete gate, weights that don't
 * total 100% despite having factors, overlapping bands, an invalid credit amount) is
 * INVALID. This never blocks the engine itself from running — the engine already
 * degrades safely on its own (Manual Review / a surfaced configError) — it only drives
 * the status badge shown to an administrator.
 */
export function computeSegmentConfigStatus(config: Configuration, segmentId: string): { status: SegmentConfigStatus; issues: string[] } {
  const segment = config.segments.find((s) => s.id === segmentId);
  if (!segment) return { status: 'INVALID', issues: ['Segment not found.'] };

  const routing = validateSegmentRouting(config.segments);
  const routingIssues = routing.issues.filter((msg) => msg.includes(`"${segment.name}"`));

  const gates = config.hardGates.filter(
    (g) => g.enabled && (!g.onlySegments || g.onlySegments.length === 0 || g.onlySegments.includes(segmentId))
  );
  const gateIssues = gates.flatMap((g) => validateHardGate(g).issues);
  const hardIssues = [...routingIssues, ...gateIssues];

  if (!segment.creditAllowed || !segment.scoringModelId) {
    return hardIssues.length > 0 ? { status: 'INVALID', issues: hardIssues } : { status: 'READY', issues: [] };
  }
  if (hardIssues.length > 0) return { status: 'INVALID', issues: hardIssues };

  const model = config.scoringModels[segment.scoringModelId];
  const bands = config.decisionBands[segment.scoringModelId] ?? [];
  const creditRule = config.creditLimitRules[segment.scoringModelId];

  const hasScoring = Boolean(model && model.inputs.length > 0);
  const hasBands = bands.length > 0;
  const hasCreditAmounts = Boolean(
    creditRule && creditRule.segmentMaximumKwd > 0 && Object.values(creditRule.tiers).some((v) => v > 0)
  );

  if (!hasScoring || !hasBands || !hasCreditAmounts) {
    const notes: string[] = [];
    if (!hasScoring) notes.push('Scoring Model has no factors configured yet.');
    if (!hasBands) notes.push('Decision Bands are not configured yet.');
    if (!hasCreditAmounts) notes.push('Credit Limits are not configured yet (Segment Maximum or Tier amounts are 0).');
    return { status: 'INCOMPLETE', issues: notes };
  }

  const modelValid = isModelValid(model!.inputs);
  const coverage = validateBandCoverage(bands);
  const tierValidation = validateBandTiers(bands);
  const approveTierNames = bands.filter((b) => b.outcome === 'APPROVE' && b.tier).map((b) => b.tier as string);
  const creditValidation = validateCreditLimitRule(creditRule!, config.globalSettings.globalMaxBnplLimit, approveTierNames);

  const softIssues = [
    ...(modelValid ? [] : [`Scoring Model total weight is ${totalWeight(model!.inputs)}%, not 100%.`]),
    ...coverage.issues,
    ...tierValidation.issues,
    ...creditValidation.issues,
  ];

  return softIssues.length > 0 ? { status: 'INVALID', issues: softIssues } : { status: 'READY', issues: [] };
}

export type SegmentTemplate = 'default' | 'empty' | { cloneFromSegmentId: string };

export interface NewSegmentInput {
  name: string;
  code: string;
  description?: string;
  product: string;
  active: boolean;
  priority: number;
  creditAllowed: boolean;
  ageMin?: number;
  ageMax?: number;
  segmentMaximumKwd: number;
  template: SegmentTemplate;
}

/**
 * Creates a new Segment plus its complete Decision Engine configuration package (Scoring
 * Model, Decision Bands, Credit Limit Rule), all keyed by the new segment's own id — never
 * by name. `routingRules` is intentionally left untouched here; the storage layer
 * regenerates it from `segments` unconditionally on the very next read.
 */
export function createSegment(config: Configuration, input: NewSegmentInput): Configuration {
  const id = `seg_${uuidv4()}`;
  const nowIso = new Date().toISOString();
  const scoringModelId = input.creditAllowed ? id : null;

  const segment: Segment = {
    id,
    code: input.code,
    name: input.name,
    description: input.description,
    product: input.product,
    active: input.active,
    priority: input.priority,
    routingMode: 'AGE_RANGE',
    ageMin: input.ageMin,
    ageMax: input.ageMax,
    creditAllowed: input.creditAllowed,
    scoringModelId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const scoringModels = { ...config.scoringModels };
  const decisionBands = { ...config.decisionBands };
  const creditLimitRules = { ...config.creditLimitRules };
  let hardGates = config.hardGates;

  if (scoringModelId) {
    const cloneSourceId = typeof input.template === 'object' ? input.template.cloneFromSegmentId : null;
    const cloneSource = cloneSourceId ? config.segments.find((s) => s.id === cloneSourceId) : undefined;
    const cloneSourceModelId = cloneSource?.scoringModelId ?? null;

    if (cloneSourceModelId && config.scoringModels[cloneSourceModelId]) {
      const sourceModel = config.scoringModels[cloneSourceModelId];
      scoringModels[scoringModelId] = { id: scoringModelId, name: input.name, inputs: sourceModel.inputs.map((i) => ({ ...i })) };
      decisionBands[scoringModelId] = (config.decisionBands[cloneSourceModelId] ?? []).map((b) => ({ ...b }));
      const sourceRule = config.creditLimitRules[cloneSourceModelId];
      creditLimitRules[scoringModelId] = { segmentMaximumKwd: input.segmentMaximumKwd, tiers: sourceRule ? { ...sourceRule.tiers } : {} };

      // Clone only the Eligibility Rules scoped specifically to the source segment — a
      // common (unscoped) gate already applies automatically and must not be duplicated.
      const clonable = config.hardGates.filter((g) => g.onlySegments && g.onlySegments.length > 0 && g.onlySegments.includes(cloneSourceModelId));
      const cloned = clonable.map((g) => ({ ...g, id: `gate_${uuidv4()}`, onlySegments: [id] }));
      hardGates = [...config.hardGates, ...cloned];
    } else {
      // Default Template and Empty Configuration both start with no invented
      // segment-specific business rules and no scoring factors — only the Decision
      // Bands shape differs (the standard 5-band structure vs. genuinely empty).
      scoringModels[scoringModelId] = { id: scoringModelId, name: input.name, inputs: [] };
      decisionBands[scoringModelId] = input.template === 'empty' ? [] : bandsFor(scoringModelId);
      creditLimitRules[scoringModelId] = { segmentMaximumKwd: input.segmentMaximumKwd, tiers: {} };
    }
  }

  return {
    ...config,
    segments: [...config.segments, segment],
    scoringModels,
    decisionBands,
    creditLimitRules,
    hardGates,
  };
}

/** What would block permanently deleting a segment — anything that still points at its id. */
export function findSegmentDeleteBlockers(segmentId: string, decisionHistory: DecisionResult[]): string[] {
  const blockers: string[] = [];
  if (decisionHistory.some((d) => d.originalSegmentId === segmentId || d.finalSegmentId === segmentId)) {
    blockers.push('This segment has historical references in Decision History and cannot be deleted. Deactivate it instead.');
  }
  return blockers;
}

/**
 * Permanently removes a segment and, if no other segment still shares its scoring model
 * id, its now-unused Scoring Model / Decision Bands / Credit Limit Rule. Any Eligibility
 * Rule scoped to this segment has the id stripped from its `onlySegments` list (an
 * eligibility rule that only ever applied here reverts to Common rather than vanishing
 * silently) — callers must check `findSegmentDeleteBlockers` first.
 */
export function deleteSegment(config: Configuration, segmentId: string): Configuration {
  const segment = config.segments.find((s) => s.id === segmentId);
  if (!segment) return config;

  const segments = config.segments.filter((s) => s.id !== segmentId);
  const modelId = segment.scoringModelId;
  const stillShared = modelId ? segments.some((s) => s.scoringModelId === modelId) : false;

  const scoringModels = { ...config.scoringModels };
  const decisionBands = { ...config.decisionBands };
  const creditLimitRules = { ...config.creditLimitRules };
  if (modelId && !stillShared) {
    delete scoringModels[modelId];
    delete decisionBands[modelId];
    delete creditLimitRules[modelId];
  }

  const hardGates = config.hardGates.map((g) =>
    g.onlySegments && g.onlySegments.includes(segmentId)
      ? { ...g, onlySegments: g.onlySegments.filter((sId) => sId !== segmentId) }
      : g
  );

  return { ...config, segments, scoringModels, decisionBands, creditLimitRules, hardGates };
}
