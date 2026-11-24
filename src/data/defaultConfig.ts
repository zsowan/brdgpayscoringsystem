import type { Configuration, CustomerDataField, HardGateRule, ScoringInputConfig, ScoringModel } from '../models/configuration';
import type { PreapprovedPolicy } from '../models/preapproved';
import type { AiAdvisorConfig } from '../models/aiAdvisor';
import type { CinetOpenAccount } from '../models/cinet';
import { CINET_STATUS_LABELS, CINET_STATUS_OPTIONS, WORST_ACCOUNT_STATUS_LABELS, WORST_ACCOUNT_STATUS_OPTIONS } from '../models/cinet';
import { NATIONALITY_LABELS, NATIONALITY_OPTIONS } from './nationalities';
import { RESIDENCY_STABILITY_LABELS } from '../utils/residency';

const CURRENT_DELINQUENCY_NOTE = 'Derived from CINET repayment and overdue data. This is a BRDG playground risk indicator, not a formal default determination.';
const WORST_ACCOUNT_STATUS_NOTE = 'MOCK DEMO VALUES — not an official CINET status catalogue.';

/**
 * Default AI Manual Review Advisor configuration — advisory-only, disabled by default in
 * neither sense: it's enabled, but the 'simulated' provider requires no API key and never
 * calls out to a real model, so the whole feature is safely on out of the box. Exported so
 * the LocalStorage migration can backfill this for configs saved before the Advisor existed.
 */
export const DEFAULT_AI_ADVISOR_CONFIG: AiAdvisorConfig = {
  enabled: true,
  provider: 'simulated',
  model: 'simulated-v1',
  temperature: 0.2,
  maxResponseTokens: 600,
  timeoutMs: 8000,
  minConfidenceThreshold: 'LOW',
  recommendationMode: 'ADVISORY_ONLY',
};

/** Reused by both the default seed and the LocalStorage migration that removes the old Active Default field. */
export const CINET_REPLACEMENT_FIELDS: CustomerDataField[] = [
  { key: 'cinet_score_cluster', displayName: 'CINET Score Cluster', type: 'string', source: 'CINET', enabled: true, visibleInPlayground: false, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Informational only — conceptually maps to CURRENTSCORECLUSTER. Not scored unless explicitly configured.', group: 'cinet', usageLabel: 'Informational' },
  { key: 'cinet_evaluation_month', displayName: 'CINET Evaluation Month', type: 'string', source: 'CINET', enabled: true, visibleInPlayground: false, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Informational only — conceptually maps to EVALUATIONMONTH. Not scored unless explicitly configured.', group: 'cinet', usageLabel: 'Informational' },
  { key: 'total_active_bnpl_accounts', displayName: 'Active BNPL Accounts', type: 'number', source: 'CINET', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: true, required: false, description: 'Number of currently open BNPL accounts reported by CINET.', group: 'cinet', usageLabel: 'Profile / Risk Data' },
  { key: 'total_monthly_bnpl_payment', displayName: 'Total Monthly BNPL Payment (KWD)', type: 'number', source: 'CINET', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: true, required: false, description: 'Total monthly payment amount across open BNPL accounts.', group: 'cinet', usageLabel: 'Financial / Risk Data' },
  { key: 'total_overdue_bnpl_amount', displayName: 'Total Overdue BNPL Amount (KWD)', type: 'number', source: 'CINET', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: true, required: false, description: 'Total overdue balance across open BNPL accounts.', group: 'cinet', usageLabel: 'Risk Data' },
  { key: 'worst_account_status', displayName: 'Worst Account Status', type: 'enum', source: 'CINET', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: true, required: false, description: WORST_ACCOUNT_STATUS_NOTE, group: 'cinet', options: [...WORST_ACCOUNT_STATUS_OPTIONS], optionLabels: WORST_ACCOUNT_STATUS_LABELS, usageLabel: 'Risk Data' },
  { key: 'max_outstanding_payments_24m', displayName: 'Max Outstanding Payments in Last 24 Months', type: 'number', source: 'CINET', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: true, required: false, description: 'Worst count of outstanding payments observed in the last 24 months.', group: 'cinet', usageLabel: 'Risk Data' },
  // Current Delinquency is a BRDG-computed indicator, but it is fundamentally sourced
  // from CINET repayment/overdue data — displayed as CINET, not a generic "Derived" tag.
  { key: 'current_delinquency', displayName: 'Current Delinquency', type: 'boolean', source: 'CINET', enabled: true, visibleInPlayground: false, useForRouting: false, useAsHardGate: true, useForScoring: false, required: false, description: CURRENT_DELINQUENCY_NOTE, group: 'cinet', usageLabel: 'Eligibility' },
];

/** Reused by both the default seed and the LocalStorage migration (Student redesign backfill). */
export const STUDENT_ALLOWANCE_FIELD: CustomerDataField = {
  key: 'student_allowance', displayName: 'Verified Student Allowance (KWD)', type: 'number', source: 'Customer Input', enabled: true, visibleInPlayground: true,
  useForRouting: false, useAsHardGate: false, useForScoring: true, required: false,
  description: 'Verified student allowance/stipend — distinct from salaried income, used only by the Student scoring model.', group: 'employment',
};

/** Student redesign backfill fields — reused by the LocalStorage migration to backfill old configs. */
export const STUDENT_BACKFILL_FIELDS: CustomerDataField[] = [
  STUDENT_ALLOWANCE_FIELD,
];

/** Reused by both the default seed and the LocalStorage migration. */
export const CINET_STATUS_FIELD: CustomerDataField = {
  key: 'cinet_status', displayName: 'CINET Assessment Status', type: 'enum', source: 'Customer Input', enabled: true, visibleInPlayground: true,
  useForRouting: false, useAsHardGate: false, useForScoring: false, required: false,
  description: 'Whether a CINET credit-score check was performed for this assessment. Independent of the other CINET bureau fields, which follow the Integration Simulator state.',
  group: 'cinet', options: [...CINET_STATUS_OPTIONS], optionLabels: CINET_STATUS_LABELS, usageLabel: 'Scoring — Optional When Unavailable',
};

/** Reused by both the default seed and the LocalStorage migration. */
export const CURRENT_DELINQUENCY_HARD_GATE: HardGateRule = {
  id: 'gate_current_delinquency',
  name: 'Current Delinquency',
  enabled: true,
  priority: 30,
  input: 'current_delinquency',
  operator: 'eq',
  value: false,
  reasonCode: 'CURRENT_DELINQUENCY_DETECTED',
  dataUnavailableReasonCode: 'CINET_DELINQUENCY_DATA_UNAVAILABLE',
};

const DEMO_OPEN_ACCOUNT: CinetOpenAccount = {
  accountNo: 'DEMO-001', accountStatus: 'CURRENT', paymentsOutstanding: 0, outstandingBalance: 300, overdueBalance: 0, dpd: 0,
};

export const DEFAULT_PREAPPROVED_POLICY: PreapprovedPolicy = {
  enabled: true,
  matchingPriority: ['verified_civil_id', 'mobile'],
  decisionOverride: {
    mode: 'floor_to_lowest_approve_tier',
    bypassesHardGates: false,
    bypassesSegment: false,
  },
};

const now = () => new Date().toISOString();

const GENDER_RESTRICTION_NOTE =
  'Gender is available for customer profile and KYC display only. It is excluded from automated credit scoring.';

/**
 * Optional residency stability scoring factor — off by default in every model.
 * Driven purely by residency duration/status (see utils/residency.ts), never nationality:
 * two residents with the same duration always land in the same category and score.
 */
/**
 * CINET Score is optional: when unavailable (not checked / timeout / error / null),
 * it is excluded entirely rather than scored with a null-default fallback, and the
 * remaining enabled factors are proportionally re-normalized for that one decision.
 */
function cinetScoreInput(idPrefix: string, weight: number): ScoringInputConfig {
  return {
    id: `${idPrefix}_cinet`,
    field: 'cinet_score',
    displayName: 'CINET Score',
    method: 'linear',
    weight,
    nullDefault: 0.3,
    enabled: true,
    min: 300,
    max: 900,
    missingDataBehavior: 'exclude_and_reweight',
  };
}

/**
 * Nationality as a scoring factor — categorical, one configured normalized score per
 * nationality code, so an administrator can adjust any single country's score
 * independently rather than the engine applying one blanket rule to "every non-Kuwaiti
 * nationality". Kuwaiti defaults to the maximum normalized score (1.00); every other
 * country seeds to the same starting value (0.50) only as an editable initial default —
 * each is its own entry in `categories`, individually reconfigurable on the Scoring
 * Inputs page, never a single collapsed "non-Kuwaiti" rule.
 */
function nationalityScoringInput(idPrefix: string, weight: number): ScoringInputConfig {
  const categories: Record<string, number> = { unknown: 0.5 };
  for (const { code } of NATIONALITY_OPTIONS) categories[code] = code === 'KW' ? 1.0 : 0.5;
  return {
    id: `${idPrefix}_nationality`,
    field: 'nationality',
    displayName: 'Nationality',
    method: 'categorical',
    weight,
    nullDefault: 0.5,
    enabled: true,
    missingDataBehavior: 'use_null_default',
    categories,
  };
}

function residencyStabilityInput(idPrefix: string): ScoringInputConfig {
  return {
    id: `${idPrefix}_residency_stability`,
    field: 'residency_stability_category',
    displayName: 'Residency Stability',
    method: 'categorical',
    weight: 10,
    nullDefault: 0.35,
    enabled: false,
    missingDataBehavior: 'use_null_default',
    categories: {
      citizen_or_permanent: 1.0,
      resident_10y_plus: 0.9,
      resident_5_10y: 0.8,
      resident_3_5y: 0.65,
      resident_under_3y: 0.45,
      unspecified: 0.35,
    },
  };
}

export const CUSTOMER_FIELDS: CustomerDataField[] = [
  // Identity
  { key: 'civil_id', displayName: 'Civil ID', type: 'string', source: 'Customer Input', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: false, required: true, description: 'National civil ID number', group: 'identity' },
  { key: 'date_of_birth', displayName: 'Date of Birth', type: 'date', source: 'PACI / Identity Provider', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: false, required: true, description: 'Used to derive age', group: 'identity' },
  { key: 'age', displayName: 'Age', type: 'number', source: 'Derived', enabled: true, visibleInPlayground: true, useForRouting: true, useAsHardGate: true, useForScoring: false, required: true, description: 'Derived from date of birth. Used for Segment Routing and the Minimum Age hard gate — no scoring model currently scores Age as an additional factor, since it would double-count the same attribute that already determined the segment.', group: 'identity' },
  { key: 'civil_id_status', displayName: 'Civil ID Status', type: 'enum', source: 'PACI / Identity Provider', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: true, useForScoring: false, required: true, description: 'VALID / EXPIRED / SUSPENDED', group: 'identity', options: ['VALID', 'EXPIRED', 'SUSPENDED'] },
  { key: 'civil_id_expiry_date', displayName: 'Civil ID Expiry Date', type: 'date', source: 'PACI / Identity Provider', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Expiry date of the civil ID', group: 'identity' },
  { key: 'mobile_id_verified', displayName: 'Mobile ID Verified', type: 'boolean', source: 'Mobile ID', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Mobile ID verification result', group: 'identity' },
  { key: 'nationality', displayName: 'Nationality', type: 'enum', source: 'PACI / Identity Provider', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: true, useForScoring: true, required: false, description: 'KYC information. Eligible as both a hard-gate eligibility condition (e.g. Student Nationality) and a configured scoring factor — actual participation in either is controlled entirely by segment configuration, never automatic. Always excluded from the AI Manual Review Advisor\'s decision context (see aiExcluded).', group: 'identity', options: NATIONALITY_OPTIONS.map((o) => o.code), optionLabels: NATIONALITY_LABELS, usageLabel: 'Hard Gate / Scoring', aiExcluded: true },
  { key: 'residency_status', displayName: 'Residency Status', type: 'enum', source: 'PACI / Identity Provider', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: true, useForScoring: false, required: false, description: 'Citizen, resident, or other residency status', group: 'identity', options: ['CITIZEN', 'RESIDENT', 'OTHER'], usageLabel: 'Profile / Eligibility' },
  { key: 'residency_start_date', displayName: 'Residency Start Date', type: 'date', source: 'PACI / Identity Provider', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Date residency began — used to derive residency stability, never nationality.', group: 'identity', usageLabel: 'Derived / Scoring Source' },
  { key: 'residency_expiry_date', displayName: 'Residency Expiry Date', type: 'date', source: 'PACI / Identity Provider', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: true, useForScoring: false, required: false, description: 'Date the residency permit expires — may be used as an eligibility condition.', group: 'identity', usageLabel: 'Eligibility / Profile' },
  { key: 'residency_duration_years', displayName: 'Residency Duration (years)', type: 'number', source: 'Derived', enabled: true, visibleInPlayground: false, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Years since residency start date.', group: 'identity', usageLabel: 'Derived' },
  { key: 'residency_remaining_months', displayName: 'Residency Remaining (months)', type: 'number', source: 'Derived', enabled: true, visibleInPlayground: false, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Months remaining until residency expiry.', group: 'identity', usageLabel: 'Derived' },
  { key: 'residency_stability_category', displayName: 'Residency Stability', type: 'enum', source: 'Derived', enabled: true, visibleInPlayground: false, useForRouting: false, useAsHardGate: false, useForScoring: true, required: false, description: 'Demo stability classification driven by residency duration/status only — never by nationality.', group: 'identity', options: ['citizen_or_permanent', 'resident_10y_plus', 'resident_5_10y', 'resident_3_5y', 'resident_under_3y', 'unspecified'], optionLabels: RESIDENCY_STABILITY_LABELS, usageLabel: 'Optional Scoring' },
  { key: 'gender', displayName: 'Gender', type: 'enum', source: 'PACI / Identity Provider', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Profile / KYC information only — excluded from automated scoring and from the AI Manual Review Advisor.', group: 'identity', options: ['MALE', 'FEMALE'], restrictedFromScoring: true, restrictionNote: GENDER_RESTRICTION_NOTE, usageLabel: 'Profile Only', aiExcluded: true },
  { key: 'email', displayName: 'Email', type: 'string', source: 'Customer Input', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Contact email', group: 'identity' },
  { key: 'mobile_number', displayName: 'Mobile Number', type: 'string', source: 'Customer Input', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Contact mobile number', group: 'identity' },
  { key: 'civil_status', displayName: 'Civil Status', type: 'string', source: 'PACI / Identity Provider', enabled: true, visibleInPlayground: false, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Marital status — excluded from the AI Manual Review Advisor as a family/marital characteristic.', group: 'identity', aiExcluded: true },
  { key: 'address_area', displayName: 'Address Area', type: 'string', source: 'PACI / Identity Provider', enabled: true, visibleInPlayground: false, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Residential area — excluded from the AI Manual Review Advisor as a demographic-proxy attribute.', group: 'identity', aiExcluded: true },
  { key: 'address_governorate', displayName: 'Address Governorate', type: 'string', source: 'PACI / Identity Provider', enabled: true, visibleInPlayground: false, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Residential governorate — excluded from the AI Manual Review Advisor as a demographic-proxy attribute.', group: 'identity', aiExcluded: true },

  // Employment & financial
  { key: 'employment_status', displayName: 'Employment Status', type: 'enum', source: 'Customer Input', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Employment status', group: 'employment', options: ['EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'STUDENT'] },
  { key: 'employer_name', displayName: 'Employer Name', type: 'string', source: 'Customer Input', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Employer name', group: 'employment' },
  { key: 'employer_tier', displayName: 'Employer Tier', type: 'enum', source: 'Internal BRDG', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: true, required: false, description: 'Employer tier classification', group: 'employment', options: ['government', 'large_corp', 'sme', 'self_employed', 'unknown'] },
  { key: 'employer_sector', displayName: 'Employer Sector', type: 'string', source: 'Internal BRDG', enabled: true, visibleInPlayground: false, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'Employer sector', group: 'employment' },
  { key: 'employment_tenure_months', displayName: 'Employment Tenure (months)', type: 'number', source: 'Customer Input', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: true, required: false, description: 'Months at current employer', group: 'employment' },
  { key: 'monthly_income', displayName: 'Monthly Income (KWD)', type: 'number', source: 'Customer Input', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: true, required: false, description: 'Declared monthly income', group: 'employment' },
  STUDENT_ALLOWANCE_FIELD,
  CINET_STATUS_FIELD,
  { key: 'cinet_score', displayName: 'CINET Score', type: 'number', source: 'CINET', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: true, required: false, description: 'Credit bureau score — conceptually maps to CINET\'s CURRENTSCORE. Optional: excluded and re-weighted when not checked or unavailable.', group: 'cinet', usageLabel: 'Scoring — Optional When Unavailable' },
  ...CINET_REPLACEMENT_FIELDS,
  { key: 'monthly_debt_obligations', displayName: 'Monthly Debt Obligations (KWD)', type: 'number', source: 'CINET', enabled: true, visibleInPlayground: true, useForRouting: false, useAsHardGate: false, useForScoring: false, required: false, description: 'BRDG-aggregated total monthly debt payment obligations — used to derive Debt-to-Income. May optionally mirror Total Monthly BNPL Payment; BNPL payment alone is never assumed to represent all customer debt.', group: 'employment', usageLabel: 'Debt-to-Income Source' },
  { key: 'debt_to_income', displayName: 'Debt-to-Income', type: 'number', source: 'Derived', enabled: true, visibleInPlayground: false, useForRouting: false, useAsHardGate: false, useForScoring: true, required: false, description: 'Always derived as monthly debt obligations ÷ monthly income — never a raw CINET value, never from BNPL account count.', group: 'employment', usageLabel: 'Scoring' },
];

/**
 * Age is already the Segment Routing attribute that puts a customer in this model in the
 * first place (21–24 → Young Adult) — it is never re-scored as an additional factor here.
 * Its 10% weight is instead given to Nationality (categorical, individually configurable
 * per nationality code — see `nationalityScoringInput`).
 */
export const youngAdultModel: ScoringModel = {
  id: 'young_adult',
  name: 'Young Adult',
  inputs: [
    { id: 'ya_income', field: 'monthly_income', displayName: 'Monthly Income', method: 'banded', weight: 30, nullDefault: 0, enabled: true, missingDataBehavior: 'use_null_default', bands: [
      { min: 0, max: 300, score: 0.0 },
      { min: 300, max: 500, score: 0.2 },
      { min: 500, max: 800, score: 0.45 },
      { min: 800, max: 1500, score: 0.65 },
      { min: 1500, max: 2500, score: 0.85 },
      { min: 2500, max: 99999, score: 1.0 },
    ] },
    { id: 'ya_tenure', field: 'employment_tenure_months', displayName: 'Employment Tenure', method: 'linear', weight: 25, nullDefault: 0.2, enabled: true, min: 0, max: 60, missingDataBehavior: 'use_null_default' },
    { id: 'ya_employer_tier', field: 'employer_tier', displayName: 'Employer Tier', method: 'categorical', weight: 20, nullDefault: 0.3, enabled: true, missingDataBehavior: 'use_null_default', categories: { government: 1.0, large_corp: 0.85, sme: 0.6, self_employed: 0.5, unknown: 0.3 } },
    cinetScoreInput('ya', 15),
    nationalityScoringInput('ya', 10),
    residencyStabilityInput('ya'),
  ],
};

/**
 * Student scoring is deliberately NOT the salaried-employee shape: age, employment
 * tenure, employer tier, salaried monthly income, and residency stability are never
 * scoring inputs here. Age is a pure segment-routing attribute — an 18-year-old and a
 * 20-year-old who both reach the Student segment score identically. Student status is
 * already established by segment routing itself (18-20 → Student) and is never
 * re-checked as a separate hard gate. Student Nationality is enforced via a Student-only
 * hard gate (see hardGates below), never as a weighted scoring factor.
 */
export const studentModel: ScoringModel = {
  id: 'student',
  name: 'Student',
  inputs: [
    {
      id: 'st_allowance', field: 'student_allowance', displayName: 'Verified Student Allowance',
      method: 'banded', weight: 40, nullDefault: 0.0, enabled: true, missingDataBehavior: 'use_null_default',
      bands: [
        { min: 0, max: 1, score: 0.0 },
        { min: 1, max: 100, score: 0.40 },
        { min: 100, max: 150, score: 0.70 },
        { min: 150, max: 999999, score: 1.00 },
      ],
    },
    {
      id: 'st_cinet', field: 'cinet_score', displayName: 'CINET Score',
      method: 'banded', weight: 35, nullDefault: 0.3, enabled: true, missingDataBehavior: 'exclude_and_reweight',
      bands: [
        { min: 300, max: 500, score: 0.20 },
        { min: 500, max: 650, score: 0.45 },
        { min: 650, max: 750, score: 0.70 },
        { min: 750, max: 901, score: 1.00 },
      ],
    },
    {
      id: 'st_exposure', field: 'debt_to_income', displayName: 'Existing Debt / Credit Exposure',
      method: 'linear_inverted', weight: 25, nullDefault: 0.3, enabled: true, min: 0, max: 1, missingDataBehavior: 'use_null_default',
    },
  ],
};

/**
 * CINET Score's weight was trimmed from 30% to 20% to make room for Nationality's 10%
 * (categorical, individually configurable per nationality code — see
 * `nationalityScoringInput`) without pushing the model's total past 100%.
 */
export const establishedModel: ScoringModel = {
  id: 'established',
  name: 'Established Customer',
  inputs: [
    { id: 'es_income', field: 'monthly_income', displayName: 'Monthly Income', method: 'banded', weight: 20, nullDefault: 0, enabled: true, missingDataBehavior: 'use_null_default', bands: [
      { min: 0, max: 300, score: 0.0 },
      { min: 300, max: 500, score: 0.2 },
      { min: 500, max: 800, score: 0.45 },
      { min: 800, max: 1500, score: 0.65 },
      { min: 1500, max: 2500, score: 0.85 },
      { min: 2500, max: 99999, score: 1.0 },
    ] },
    cinetScoreInput('es', 20),
    { id: 'es_dti', field: 'debt_to_income', displayName: 'Debt-to-Income', method: 'linear_inverted', weight: 25, nullDefault: 0.3, enabled: true, min: 0, max: 1, missingDataBehavior: 'use_null_default' },
    { id: 'es_tenure', field: 'employment_tenure_months', displayName: 'Employment Tenure', method: 'linear', weight: 15, nullDefault: 0.3, enabled: true, min: 0, max: 120, missingDataBehavior: 'use_null_default' },
    { id: 'es_employer_tier', field: 'employer_tier', displayName: 'Employer Tier', method: 'categorical', weight: 10, nullDefault: 0.3, enabled: true, missingDataBehavior: 'use_null_default', categories: { government: 1.0, large_corp: 0.85, sme: 0.6, self_employed: 0.5, unknown: 0.3 } },
    nationalityScoringInput('es', 10),
    residencyStabilityInput('es'),
  ],
};

/**
 * Decision Bands determine ONLY the Final Decision and Risk Tier from the final score —
 * never a monetary amount. Each segment gets its own independent copy of these bands, so
 * changing one segment's thresholds never affects another. Tier credit limit amounts are
 * configured separately, in `creditLimitRules` below.
 */
export function bandsFor(idPrefix: string): Configuration['decisionBands'][string] {
  return [
    { id: `${idPrefix}_reject`, min: 0.0, max: 0.3, outcome: 'REJECT' },
    { id: `${idPrefix}_review`, min: 0.3, max: 0.45, outcome: 'MANUAL_REVIEW' },
    { id: `${idPrefix}_tierc`, min: 0.45, max: 0.6, outcome: 'APPROVE', tier: 'Tier C' },
    { id: `${idPrefix}_tierb`, min: 0.6, max: 0.75, outcome: 'APPROVE', tier: 'Tier B' },
    { id: `${idPrefix}_tiera`, min: 0.75, max: 1.01, outcome: 'APPROVE', tier: 'Tier A' },
  ];
}

/**
 * Student Eligibility Rules — evaluated as an ordinary hard gate, scoped only to the
 * Student segment via `onlySegments` ("Applies To Segments") so no other segment is
 * affected. Civil ID validity and no-active-default are already covered by the global
 * hard gates below (they apply to every segment); age 18–20 is guaranteed by segment
 * routing itself, and student status is established by that same routing — neither is
 * re-checked as a separate hard gate. This is a business eligibility gate, never a
 * scoring factor — Nationality remains permanently barred from scoring (see the
 * `nationality` field's `restrictedFromScoring` flag). Reused by both the default seed
 * and the LocalStorage migration.
 */
export const STUDENT_ONLY_HARD_GATES: HardGateRule[] = [
  { id: 'gate_student_nationality', name: 'Student Nationality', enabled: true, priority: 20, input: 'nationality', operator: 'eq', value: 'KW', reasonCode: 'STUDENT_NATIONALITY_NOT_ELIGIBLE', dataUnavailableReasonCode: 'STUDENT_NATIONALITY_DATA_UNAVAILABLE', onlySegments: ['student'] },
];

/**
 * Civil ID Status is not an eligibility condition for Kuwaiti nationals — it exists to
 * catch an expired/suspended residency civil ID for non-Kuwaiti customers. Applies
 * regardless of segment. Reused by both the default seed and the LocalStorage migration.
 */
export const CIVIL_ID_STATUS_SKIP_CONDITIONS = [{ field: 'nationality', operator: 'eq' as const, value: 'KW' }];
export const CIVIL_ID_STATUS_SKIP_DESCRIPTION = 'Kuwaiti customer – Civil ID Status eligibility check not required';

/**
 * Canonical Credit Limit Rules for the three built-in segments — the ONLY place monetary
 * credit limit amounts are configured. Exported so the LocalStorage migration layer can
 * repair a saved configuration whose rules were corrupted by a past bug, without having to
 * duplicate these numbers.
 */
export const DEFAULT_CREDIT_LIMIT_RULES: Configuration['creditLimitRules'] = {
  student: { segmentMaximumKwd: 100, tiers: { 'Tier C': 50, 'Tier B': 75, 'Tier A': 100 } },
  young_adult: { segmentMaximumKwd: 500, tiers: { 'Tier C': 150, 'Tier B': 300, 'Tier A': 500 } },
  established: { segmentMaximumKwd: 500, tiers: { 'Tier C': 150, 'Tier B': 300, 'Tier A': 500 } },
};

export function buildDefaultConfiguration(): Configuration {
  return {
    id: 'config-v1',
    versionLabel: 'v1',
    status: 'ACTIVE',
    createdAt: now(),
    updatedAt: now(),
    notes: 'Initial default configuration seeded from playground defaults.',
    segments: [
      {
        id: 'student', code: 'student', name: 'Student', ageMin: 18, ageMax: 20, product: 'Student BNPL',
        creditAllowed: true, scoringModelId: 'student', active: true, priority: 10, routingMode: 'AGE_RANGE',
        createdAt: now(), updatedAt: now(),
        description: 'Entry-level BNPL for 18-20 year olds — subject to Student nationality eligibility.',
      },
      {
        id: 'young_adult', code: 'young_adult', name: 'Young Adult', ageMin: 21, ageMax: 24, product: 'Starter BNPL',
        creditAllowed: true, scoringModelId: 'young_adult', active: true, priority: 20, routingMode: 'AGE_RANGE',
        createdAt: now(), updatedAt: now(),
        description: 'Starter BNPL product.',
      },
      {
        id: 'established', code: 'established', name: 'Established', ageMin: 25, product: 'Standard BNPL',
        creditAllowed: true, scoringModelId: 'established', active: true, priority: 30, routingMode: 'AGE_RANGE',
        createdAt: now(), updatedAt: now(),
        description: 'Standard BNPL product.',
      },
    ],
    // Derived entirely from the segments above (see engine/segmentEngine.ts's
    // `buildRoutingRulesFromSegments`, which the storage layer re-applies on every load) —
    // written out literally here only because the very first ever load seeds this object
    // directly, before any normalization step runs.
    routingRules: [
      { id: 'route_student', priority: 10, enabled: true, conditions: [{ field: 'age', operator: 'gte', value: 18 }, { field: 'age', operator: 'lte', value: 20 }], targetSegmentId: 'student', description: '18–20 → Student' },
      { id: 'route_young_adult', priority: 20, enabled: true, conditions: [{ field: 'age', operator: 'gte', value: 21 }, { field: 'age', operator: 'lte', value: 24 }], targetSegmentId: 'young_adult', description: '21–24 → Young Adult' },
      { id: 'route_established', priority: 30, enabled: true, conditions: [{ field: 'age', operator: 'gte', value: 25 }], targetSegmentId: 'established', description: '25+ → Established' },
    ],
    hardGates: [
      // Minimum Age is evaluated as a dedicated prerequisite (see decisionEngine.ts) before
      // any segment is determined — there is no segment exemption for it.
      { id: 'gate_min_age', name: 'Minimum Age', enabled: true, priority: 10, input: 'age', operator: 'gte', value: 18, reasonCode: 'UNDER_MINIMUM_AGE', dataUnavailableReasonCode: 'AGE_DATA_UNAVAILABLE' },
      ...STUDENT_ONLY_HARD_GATES,
      CURRENT_DELINQUENCY_HARD_GATE,
      {
        id: 'gate_civil_id_status', name: 'Civil ID Status', enabled: true, priority: 40, input: 'civil_id_status', operator: 'eq', value: 'VALID',
        reasonCode: 'INVALID_CIVIL_ID', dataUnavailableReasonCode: 'CIVIL_ID_STATUS_DATA_UNAVAILABLE',
        skipConditions: CIVIL_ID_STATUS_SKIP_CONDITIONS, skipDescription: CIVIL_ID_STATUS_SKIP_DESCRIPTION,
      },
    ],
    customerFields: CUSTOMER_FIELDS,
    scoringModels: {
      student: studentModel,
      young_adult: youngAdultModel,
      established: establishedModel,
    },
    decisionBands: {
      student: bandsFor('student'),
      young_adult: bandsFor('young_adult'),
      established: bandsFor('established'),
    },
    // The ONLY place monetary credit limits are configured: Segment + Tier → amount,
    // plus a flat Segment Maximum cap. Final Credit Limit = MIN(Tier Credit Limit,
    // Segment Maximum, Global Maximum BNPL Limit) — never a formula, never derived from income.
    creditLimitRules: {
      student: { ...DEFAULT_CREDIT_LIMIT_RULES.student, tiers: { ...DEFAULT_CREDIT_LIMIT_RULES.student.tiers } },
      young_adult: { ...DEFAULT_CREDIT_LIMIT_RULES.young_adult, tiers: { ...DEFAULT_CREDIT_LIMIT_RULES.young_adult.tiers } },
      established: { ...DEFAULT_CREDIT_LIMIT_RULES.established, tiers: { ...DEFAULT_CREDIT_LIMIT_RULES.established.tiers } },
    },
    globalSettings: {
      globalMaxBnplLimit: 500,
      manualReviewMissingWeightThreshold: 50,
      dtiSourceMode: 'separate_obligation',
    },
    integrations: [
      { id: 'paci', name: 'PACI', state: 'ONLINE', fields: ['date_of_birth', 'age', 'civil_id_status', 'civil_id_expiry_date', 'residency_status', 'residency_start_date', 'residency_expiry_date', 'nationality', 'employer_name'], mockData: { date_of_birth: '2000-01-15', age: 26, civil_id_status: 'VALID', civil_id_expiry_date: '2028-01-15', residency_status: 'RESIDENT', residency_start_date: '2018-01-01', residency_expiry_date: '2028-12-31', nationality: 'JO', employer_name: 'Ministry of Finance' } },
      {
        id: 'cinet', name: 'CINET', state: 'ONLINE',
        fields: ['cinet_score', 'cinet_score_cluster', 'cinet_evaluation_month', 'total_active_bnpl_accounts', 'total_monthly_bnpl_payment', 'total_overdue_bnpl_amount', 'worst_account_status', 'max_outstanding_payments_24m', 'cinet_open_accounts', 'monthly_debt_obligations'],
        mockData: {
          cinet_score: 720,
          cinet_score_cluster: 'DEMO_A',
          cinet_evaluation_month: '2026-09',
          total_active_bnpl_accounts: 1,
          total_monthly_bnpl_payment: 80,
          total_overdue_bnpl_amount: 0,
          worst_account_status: 'CURRENT',
          max_outstanding_payments_24m: 0,
          cinet_open_accounts: [DEMO_OPEN_ACCOUNT],
          monthly_debt_obligations: 100,
        },
      },
      { id: 'mobile_id', name: 'Mobile ID', state: 'ONLINE', fields: ['mobile_id_verified'], mockData: { mobile_id_verified: true } },
    ],
    preapprovedMarketing: { ...DEFAULT_PREAPPROVED_POLICY, decisionOverride: { ...DEFAULT_PREAPPROVED_POLICY.decisionOverride } },
    aiAdvisor: { ...DEFAULT_AI_ADVISOR_CONFIG },
  };
}
