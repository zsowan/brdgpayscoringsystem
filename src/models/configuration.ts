// Core configuration model — everything the scoring/decision engine reads.
// UI components and engine logic must treat this as data, never hard-code business rules.

import type { PreapprovedPolicy } from './preapproved';
import type { AiAdvisorConfig } from './aiAdvisor';

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum';

export type FieldSource =
  | 'Customer Input'
  | 'PACI / Identity Provider'
  | 'CINET'
  | 'Mobile ID'
  | 'Internal BRDG'
  | 'Commercial Registry'
  | 'Derived'
  | 'Mock Integration';

export type FieldGroup = 'identity' | 'employment' | 'cinet' | 'additional' | 'other';

export interface CustomerDataField {
  key: string;
  displayName: string;
  type: FieldType;
  source: FieldSource;
  enabled: boolean;
  visibleInPlayground: boolean;
  useForRouting: boolean;
  useAsHardGate: boolean;
  useForScoring: boolean;
  required: boolean;
  description: string;
  group: FieldGroup;
  options?: string[];
  /** Display label per option code, e.g. { KW: 'Kuwaiti' } — falls back to the raw code when absent. */
  optionLabels?: Record<string, string>;
  /** Fields like gender/nationality are permanently barred from automated scoring. */
  restrictedFromScoring?: boolean;
  /** Shown in the Customer Data Fields UI when a field is restricted from scoring. */
  restrictionNote?: string;
  /** Short human summary of how this field may be used, e.g. "Profile Only", "Derived / Scoring Source". */
  usageLabel?: string;
  /**
   * True for protected/demographic attributes (gender, nationality, marital/family
   * status, address-as-demographic-proxy, etc.). Such a field may still be used by the
   * deterministic engine (e.g. Nationality already participates in scoring/hard gates —
   * see `restrictedFromScoring`, a separate, older flag), but its value is always
   * stripped out before building the AI Advisor's decision package — the AI must never
   * see it, regardless of whether the deterministic engine uses it.
   */
  aiExcluded?: boolean;
}

export type ComparisonOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'is_null' | 'is_not_null';

export interface Condition {
  field: string;
  operator: ComparisonOperator;
  value?: unknown;
}

/**
 * How this segment's routing conditions are evaluated. "AGE_RANGE" (the only mode
 * currently implemented) derives a matching RoutingRule from `ageMin`/`ageMax` alone.
 * "ADVANCED" is reserved for a future rule-based mode (employment type, residency,
 * product type, etc.) — the field exists now so that future mode never requires a
 * schema migration, but no advanced-condition engine is implemented yet.
 */
export type SegmentRoutingMode = 'AGE_RANGE' | 'ADVANCED';

export interface Segment {
  /** Stable, unique, never reused — every segment-scoped config (scoring model, decision
   *  bands, credit limit rules, hard-gate `onlySegments` entries) is keyed by this id, never
   *  by `name`, so renaming a segment can never break its configuration. */
  id: string;
  /** Short, stable, human-chosen slug (e.g. "student", "school_student") — informational/
   *  exportable only; never used as a join key (that's always `id`). */
  code: string;
  /** Display name — freely renamable without affecting any configuration. */
  name: string;
  description?: string;
  product: string;
  /** When false: new customers are never routed here, and the segment is hidden from the
   *  Decision Engine page's default tab list — but its entire configuration and decision
   *  history are preserved untouched, and it can be reactivated at any time. */
  active: boolean;
  /** Evaluation order for routing (lower first) — also the display order everywhere else. */
  priority: number;
  routingMode: SegmentRoutingMode;
  ageMin?: number;
  ageMax?: number;
  creditAllowed: boolean;
  scoringModelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutingRule {
  id: string;
  priority: number;
  enabled: boolean;
  conditions: Condition[];
  targetSegmentId: string;
  description?: string;
  isCatchAll?: boolean;
}

export interface HardGateRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  input: string;
  operator: ComparisonOperator;
  value?: unknown;
  reasonCode: string;
  /**
   * "Applies To Segments". When empty/absent, this gate applies to every segment. When
   * one or more segment ids are set, it applies ONLY to those segments — it is filtered
   * out entirely (never evaluated, never shown) for every other segment, since it's a
   * segment-specific eligibility rule (e.g. Student Nationality).
   */
  onlySegments?: string[];
  /** Reason code used when the input is unavailable (indeterminate) rather than failed —
   *  e.g. a CINET outage — so the audit trail distinguishes "no delinquency" from "unknown". */
  dataUnavailableReasonCode?: string;
  /**
   * When ALL of these conditions match the customer, this gate is not evaluated at all —
   * neither pass nor fail — and is reported as "Not Applicable" in the audit trail. Used
   * for rules that only make sense for part of the customer base, e.g. Civil ID Status is
   * not an eligibility condition for Kuwaiti nationals. A skipped gate never contributes a
   * pass, a fail, or an indeterminate result.
   */
  skipConditions?: Condition[];
  /** Human-readable reason shown in the audit trail when `skipConditions` causes this gate to be skipped. */
  skipDescription?: string;
}

export type NormalizationMethod = 'linear' | 'linear_inverted' | 'banded' | 'categorical' | 'boolean';

export interface BandDef { min: number; max: number; score: number; }

/**
 * How to treat a scoring factor when its raw value is unavailable:
 * - "use_null_default": score it with the configured `nullDefault` fallback (0–1).
 * - "exclude_and_reweight": drop the factor entirely from this one decision and
 *   proportionally re-normalize the remaining available factors' weights back up to
 *   100% — it neither penalizes nor rewards the customer for data that was never checked.
 * - "manual_review": same scoring-math treatment as "exclude_and_reweight" (excluded,
 *   remaining factors re-weighted), but additionally forces the overall decision to
 *   Manual Review — used for factors where a human must judge in the data's absence.
 */
export type MissingDataBehavior = 'use_null_default' | 'exclude_and_reweight' | 'manual_review';

export interface ScoringInputConfig {
  id: string;
  field: string;
  displayName: string;
  method: NormalizationMethod;
  weight: number;
  /** Normalized fallback score (0–1) used only when missingDataBehavior is "use_null_default". */
  nullDefault: number;
  enabled: boolean;
  min?: number;
  max?: number;
  bands?: BandDef[];
  categories?: Record<string, number>;
  booleanScores?: { trueScore: number; falseScore: number };
  missingDataBehavior: MissingDataBehavior;
}

export interface ScoringModel {
  id: string;
  name: string;
  inputs: ScoringInputConfig[];
}

export type DecisionOutcome = 'APPROVE' | 'MANUAL_REVIEW' | 'REJECT';

/**
 * Decision Bands determine ONLY the Final Decision and Risk Tier from the final score —
 * they never carry a monetary amount. Credit limit amounts live exclusively in
 * `creditLimitRules` (see `SegmentCreditLimitRule`), keyed by the same Tier name.
 */
export interface DecisionBandDef {
  id: string;
  min: number;
  max: number;
  outcome: DecisionOutcome;
  tier?: string;
}

/**
 * The ONLY place monetary credit limits are configured: Segment + Tier → proposed
 * credit limit. `segmentMaximumKwd` is a flat cap for this scoring model, regardless of
 * tier. `tiers` maps a Tier name (matching a `DecisionBandDef.tier` value for the same
 * scoring model) to its proposed credit limit in KWD.
 */
export interface SegmentCreditLimitRule {
  segmentMaximumKwd: number;
  tiers: Record<string, number>;
}

export interface GlobalSettings {
  /**
   * Global Maximum BNPL Limit — a hard ceiling applied to every approved decision
   * regardless of segment or tier. Acts only as a cap in MIN(Decision Band Limit,
   * Segment Maximum, Global Maximum BNPL Limit); it never determines the limit itself.
   */
  globalMaxBnplLimit: number;
  manualReviewMissingWeightThreshold: number;
  /**
   * How the BRDG-aggregated monthly_debt_obligations figure is sourced for demo purposes:
   * "separate_obligation" (default) keeps it as its own mock/editable value; "bnpl_payment"
   * mirrors it from CINET's total_monthly_bnpl_payment. BNPL payment alone is never assumed
   * to represent all of a customer's debt — this is an explicit, configurable demo choice.
   */
  dtiSourceMode: 'separate_obligation' | 'bnpl_payment';
}

export type IntegrationState = 'ONLINE' | 'TIMEOUT' | 'ERROR';

export interface IntegrationConfig {
  id: string;
  name: string;
  state: IntegrationState;
  fields: string[];
  mockData: Record<string, unknown>;
}

export type ConfigStatus = 'DRAFT' | 'IN_REVIEW' | 'ACTIVE' | 'RETIRED';

export interface Configuration {
  id: string;
  versionLabel: string;
  status: ConfigStatus;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  segments: Segment[];
  routingRules: RoutingRule[];
  hardGates: HardGateRule[];
  customerFields: CustomerDataField[];
  scoringModels: Record<string, ScoringModel>;
  decisionBands: Record<string, DecisionBandDef[]>;
  /**
   * Credit Limit Rules per scoring model (same key space as `decisionBands`) — the ONLY
   * place monetary credit limits are configured. Final Credit Limit = MIN(Tier Credit
   * Limit, Segment Maximum, Global Maximum BNPL Limit); never a formula input, never
   * derived from income.
   */
  creditLimitRules: Record<string, SegmentCreditLimitRule>;
  globalSettings: GlobalSettings;
  integrations: IntegrationConfig[];
  preapprovedMarketing: PreapprovedPolicy;
  /** Advisory-only AI layer for Manual Review cases — see models/aiAdvisor.ts. Never used
   *  by Segment Routing, Eligibility Rules, Scoring, Decision Bands, or Credit Limits. */
  aiAdvisor: AiAdvisorConfig;
}
