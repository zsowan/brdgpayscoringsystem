import type { CustomerRecord } from '../models/customer';
import type { DecisionBandDef, DecisionOutcome } from '../models/configuration';
import type { PreapprovedEntry, PreapprovedFloorResult, PreapprovedMatchResult } from '../models/preapproved';

export function normalizeCivilId(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Strips formatting and country-code noise down to the last 8 digits (Kuwait local mobile length). */
export function normalizePhone(value: unknown): string {
  if (value === null || value === undefined) return '';
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 8 ? digits.slice(-8) : digits;
}

/**
 * A civil ID only counts as "verified" once the mock PACI check says so — never the
 * customer's raw typed input. Preapproved matching must never trust an unverified claim.
 */
export function getVerifiedCivilId(customer: CustomerRecord): string | null {
  const verified = customer.civil_id_status === 'VALID';
  if (!verified) return null;
  const civilId = customer.civil_id;
  return civilId ? String(civilId) : null;
}

/**
 * Matching order: verified civil ID first, normalized mobile second, else no match.
 * A civil ID match always wins over a phone match, even if both exist and point to
 * different entries.
 */
export function findPreapprovedMatch(
  verifiedCivilId: string | null,
  customerMobile: unknown,
  entries: PreapprovedEntry[]
): PreapprovedMatchResult {
  if (verifiedCivilId) {
    const normalized = normalizeCivilId(verifiedCivilId);
    const civilMatch = entries.find(
      (entry) => entry.status === 'active' && entry.civilId && normalizeCivilId(entry.civilId) === normalized
    );
    if (civilMatch) return { status: 'matched_civil_id', entry: civilMatch };
  }

  const normalizedMobile = normalizePhone(customerMobile);
  if (normalizedMobile) {
    const phoneMatch = entries.find(
      (entry) => entry.status === 'active' && entry.mobile && normalizePhone(entry.mobile) === normalizedMobile
    );
    if (phoneMatch) return { status: 'matched_phone', entry: phoneMatch };
  }

  return { status: 'not_matched' };
}

/** Dynamically inspects configured Decision Bands rather than hard-coding a tier name. */
export function getLowestApprovedBand(bands: DecisionBandDef[]): DecisionBandDef | null {
  const approveBands = bands.filter((b) => b.outcome === 'APPROVE').sort((a, b) => a.min - b.min);
  return approveBands[0] ?? null;
}

export interface ApplyPreapprovedFloorArgs {
  policyEnabled: boolean;
  matchResult: PreapprovedMatchResult;
  hardGatePassed: boolean;
  segmentId: string;
  originalDecision: DecisionOutcome;
  originalTier: string | null;
  decisionBands: DecisionBandDef[];
}

/**
 * Promotes a non-approve decision to the lowest configured approve tier for a
 * matched preapproved customer — but only after hard gates passed (this is also
 * how a customer below the Minimum Age gate is protected: preapproval can never
 * apply once the customer failed eligibility). Never bypasses that check, and
 * never invents a limit: the caller still runs the normal credit-limit formula
 * against the resulting band.
 */
export function applyPreapprovedDecisionFloor(args: ApplyPreapprovedFloorArgs): PreapprovedFloorResult {
  const { policyEnabled, matchResult, hardGatePassed, originalDecision, originalTier, decisionBands } = args;

  const unchanged = (reasonCode: string | null): PreapprovedFloorResult => ({
    applied: false,
    decisionOutcome: originalDecision,
    tier: originalTier,
    reasonCode,
    configError: false,
  });

  if (!policyEnabled) return unchanged(null);
  if (matchResult.status === 'not_matched') return unchanged(null);
  if (!hardGatePassed) return unchanged('PREAPPROVED_BLOCKED_BY_HARD_GATE');
  if (originalDecision === 'APPROVE') return unchanged('PREAPPROVED_ALREADY_APPROVED');

  const lowestBand = getLowestApprovedBand(decisionBands);
  if (!lowestBand) {
    return {
      applied: false,
      decisionOutcome: originalDecision,
      tier: originalTier,
      reasonCode: 'PREAPPROVED_CONFIG_ERROR',
      configError: true,
    };
  }

  return {
    applied: true,
    decisionOutcome: 'APPROVE',
    tier: lowestBand.tier ?? null,
    reasonCode: 'PREAPPROVED_FLOOR_APPLIED',
    configError: false,
  };
}

export function matchStatusReasonCode(status: PreapprovedMatchResult['status']): string {
  if (status === 'matched_civil_id') return 'PREAPPROVED_MATCH_CIVIL_ID';
  if (status === 'matched_phone') return 'PREAPPROVED_MATCH_PHONE';
  return 'PREAPPROVED_NOT_MATCHED';
}
