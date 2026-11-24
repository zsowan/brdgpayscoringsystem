import type { ScoringInputConfig } from '../models/configuration';

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function linearScore(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp01((value - min) / (max - min));
}

export function linearInvertedScore(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp01(1 - (value - min) / (max - min));
}

export function bandedScore(value: number, bands: { min: number; max: number; score: number }[]): number {
  const band = bands.find((b) => value >= b.min && value < b.max);
  if (band) return clamp01(band.score);
  // value falls above the last band's max (or below the first) — clamp to nearest edge
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  if (sorted.length === 0) return 0;
  if (value < sorted[0].min) return clamp01(sorted[0].score);
  return clamp01(sorted[sorted.length - 1].score);
}

export function categoricalScore(value: string, categories: Record<string, number>): number {
  if (value in categories) return clamp01(categories[value]);
  return clamp01(categories['unknown'] ?? 0);
}

export function booleanScore(value: boolean, def: { trueScore: number; falseScore: number }): number {
  return clamp01(value ? def.trueScore : def.falseScore);
}

/**
 * Normalizes one raw field value using the input's configured method.
 * Returns the 0..1 score plus a human-readable reason for the audit trail.
 */
export function normalizeInput(
  input: ScoringInputConfig,
  rawValue: unknown
): { score: number; reason: string; missing: boolean } {
  const isMissing = rawValue === null || rawValue === undefined || rawValue === '';

  if (isMissing) {
    return {
      score: clamp01(input.nullDefault),
      reason: `Value unavailable — applied configured null default (${input.nullDefault.toFixed(2)})`,
      missing: true,
    };
  }

  switch (input.method) {
    case 'linear': {
      const v = Number(rawValue);
      const score = linearScore(v, input.min ?? 0, input.max ?? 1);
      return { score, reason: `Linear (${input.min}–${input.max}) on value ${v}`, missing: false };
    }
    case 'linear_inverted': {
      const v = Number(rawValue);
      const score = linearInvertedScore(v, input.min ?? 0, input.max ?? 1);
      return { score, reason: `Linear inverted (${input.min}–${input.max}) on value ${v}`, missing: false };
    }
    case 'banded': {
      const v = Number(rawValue);
      const bands = input.bands ?? [];
      const score = bandedScore(v, bands);
      const band = bands.find((b) => v >= b.min && v < b.max);
      return {
        score,
        reason: band ? `Banded: value ${v} in [${band.min}, ${band.max}) → ${band.score.toFixed(2)}` : `Banded: value ${v} outside configured bands`,
        missing: false,
      };
    }
    case 'categorical': {
      const v = String(rawValue);
      const categories = input.categories ?? {};
      const score = categoricalScore(v, categories);
      return { score, reason: `Categorical: "${v}" → ${score.toFixed(2)}`, missing: false };
    }
    case 'boolean': {
      const v = Boolean(rawValue);
      const def = input.booleanScores ?? { trueScore: 1, falseScore: 0 };
      const score = booleanScore(v, def);
      return { score, reason: `Boolean: ${v} → ${score.toFixed(2)}`, missing: false };
    }
    default:
      return { score: 0, reason: 'Unknown normalization method', missing: false };
  }
}

/** Sums the weight of enabled scoring inputs — used to validate a model totals 100%. */
export function totalWeight(inputs: ScoringInputConfig[]): number {
  return inputs.filter((i) => i.enabled).reduce((sum, i) => sum + i.weight, 0);
}

export function isModelValid(inputs: ScoringInputConfig[]): boolean {
  const total = totalWeight(inputs);
  return Math.abs(total - 100) < 0.01;
}
