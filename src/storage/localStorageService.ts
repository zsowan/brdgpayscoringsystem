import { v4 as uuidv4 } from 'uuid';
import type { Configuration, ScoringModel, Segment } from '../models/configuration';
import type { DecisionResult } from '../models/decision';
import {
  buildDefaultConfiguration,
  CIVIL_ID_STATUS_SKIP_CONDITIONS,
  CIVIL_ID_STATUS_SKIP_DESCRIPTION,
  DEFAULT_AI_ADVISOR_CONFIG,
  DEFAULT_CREDIT_LIMIT_RULES,
  DEFAULT_PREAPPROVED_POLICY,
  CINET_REPLACEMENT_FIELDS,
  CINET_STATUS_FIELD,
  CURRENT_DELINQUENCY_HARD_GATE,
  STUDENT_BACKFILL_FIELDS,
  STUDENT_ONLY_HARD_GATES,
  studentModel as defaultStudentModel,
  youngAdultModel as defaultYoungAdultModel,
  establishedModel as defaultEstablishedModel,
} from '../data/defaultConfig';
import { buildRoutingRulesFromSegments } from '../engine/segmentEngine';

/** Back-fills configs saved before the Preapproved Marketing List policy existed. */
function withPreapprovedDefaults(config: Configuration): Configuration {
  if (config.preapprovedMarketing) return config;
  return { ...config, preapprovedMarketing: { ...DEFAULT_PREAPPROVED_POLICY, decisionOverride: { ...DEFAULT_PREAPPROVED_POLICY.decisionOverride } } };
}

/** Back-fills the Debt-to-Income source-mode setting for configs saved before it existed. */
function withGlobalSettingsDefaults(config: Configuration): Configuration {
  if (config.globalSettings.dtiSourceMode) return config;
  return { ...config, globalSettings: { ...config.globalSettings, dtiSourceMode: 'separate_obligation' } };
}

/**
 * The Formula/Multiplier credit limit mode was removed — the credit limit is now always
 * MIN(Decision Band Limit, Segment Maximum, Global Maximum BNPL Limit), where Segment
 * Maximum is a flat cap per scoring model (`segmentMaxLimits`, same key space as
 * `decisionBands`). Migrate configs saved before that change: rename the old
 * `regulatoryCap` global setting to `globalMaxBnplLimit`, derive `segmentMaxLimits` from
 * whatever ceiling each segment used to carry (`defaultCeiling`/`maxLimit`, depending on
 * how old the saved config is), and drop the per-model `creditLimitRules`
 * (mode/formulaField/multiplier) and per-segment ceiling fields entirely.
 */
function withoutFormulaCreditLimit(config: Configuration): Configuration {
  const rawConfig = config as unknown as Record<string, unknown>;
  const rawGlobalSettings = config.globalSettings as unknown as Record<string, unknown>;
  const hasCreditLimitRules = 'creditLimitRules' in rawConfig;
  const needsGlobalRename = config.globalSettings.globalMaxBnplLimit === undefined;
  // A config that already has the current `creditLimitRules` shape never needs
  // `segmentMaxLimits` re-derived — only a genuinely ancient config (missing BOTH the old
  // `segmentMaxLimits` map and the current `creditLimitRules`) needs this legacy step.
  const needsCapsMigration = !('segmentMaxLimits' in rawConfig) && !hasCreditLimitRules;
  const hasLegacySegmentField = config.segments.some((s) => {
    const raw = s as unknown as Record<string, unknown>;
    return 'defaultCeiling' in raw || 'maxLimit' in raw;
  });
  if (!needsGlobalRename && !needsCapsMigration && !hasLegacySegmentField) return config;

  const globalMaxBnplLimit = needsGlobalRename
    ? typeof rawGlobalSettings.regulatoryCap === 'number'
      ? rawGlobalSettings.regulatoryCap
      : 500
    : config.globalSettings.globalMaxBnplLimit;

  const segments = config.segments.map((s) => {
    const raw = { ...(s as unknown as Record<string, unknown>) };
    delete raw.defaultCeiling;
    delete raw.maxLimit;
    return raw as unknown as Segment;
  });

  const base = {
    ...config,
    segments,
    globalSettings: { ...config.globalSettings, globalMaxBnplLimit, regulatoryCap: undefined },
  };

  // Already on the current shape — leave `creditLimitRules` completely untouched. Only a
  // genuinely legacy config (below) ever has it stripped and replaced with the transient
  // `segmentMaxLimits` shape that `withCreditLimitRulesSeparation` later converts properly.
  if (hasCreditLimitRules) {
    return base as unknown as Configuration;
  }

  let segmentMaxLimits: Record<string, number>;
  if (needsCapsMigration) {
    segmentMaxLimits = {};
    for (const modelId of Object.keys(config.scoringModels)) {
      const owningSegment = config.segments.find((s) => s.scoringModelId === modelId);
      const raw = owningSegment as unknown as Record<string, unknown> | undefined;
      const legacyCeiling = raw?.maxLimit ?? raw?.defaultCeiling;
      segmentMaxLimits[modelId] = typeof legacyCeiling === 'number' ? legacyCeiling : 500;
    }
  } else {
    segmentMaxLimits = rawConfig.segmentMaxLimits as Record<string, number>;
  }

  return { ...base, segmentMaxLimits } as unknown as Configuration;
}

const NEW_CINET_INTEGRATION_FIELDS = [
  'cinet_score_cluster', 'cinet_evaluation_month', 'total_active_bnpl_accounts',
  'total_monthly_bnpl_payment', 'total_overdue_bnpl_amount', 'worst_account_status',
  'max_outstanding_payments_24m', 'cinet_open_accounts',
];

const DEFAULT_CINET_MOCK: Record<string, unknown> = {
  cinet_score_cluster: 'DEMO_A',
  cinet_evaluation_month: '2026-09',
  total_active_bnpl_accounts: 1,
  total_monthly_bnpl_payment: 80,
  total_overdue_bnpl_amount: 0,
  worst_account_status: 'CURRENT',
  max_outstanding_payments_24m: 0,
  cinet_open_accounts: [{ accountNo: 'DEMO-001', accountStatus: 'CURRENT', paymentsOutstanding: 0, outstandingBalance: 300, overdueBalance: 0, dpd: 0 }],
};

/**
 * The old simplified CINET presentation (Active Default / Active Loans) was replaced
 * with fields aligned to the CINET BNPL Live Request User Manual, plus a derived
 * Current Delinquency indicator. Migrate any config saved before that change so it
 * never resurrects the old fields or hard gate.
 */
function withCinetRefresh(config: Configuration): Configuration {
  const hasOldCinetFields = config.customerFields.some((f) => f.key === 'active_default' || f.key === 'active_loans');
  if (!hasOldCinetFields) return config;

  const existingKeys = new Set(config.customerFields.map((f) => f.key));
  const fieldsWithoutOld = config.customerFields
    .filter((f) => f.key !== 'active_default' && f.key !== 'active_loans' && f.key !== 'late_payment_count')
    .map((f) => (f.key === 'cinet_score' ? { ...f, group: 'cinet' as const } : f));
  const newFields = CINET_REPLACEMENT_FIELDS.filter((f) => !existingKeys.has(f.key));

  const hardGates = config.hardGates.map((g) =>
    g.input === 'active_default'
      ? { ...CURRENT_DELINQUENCY_HARD_GATE, id: g.id, priority: g.priority, onlySegments: g.onlySegments }
      : g
  );

  const integrations = config.integrations.map((integration) => {
    if (integration.id !== 'cinet') return integration;
    const fields = integration.fields.filter((f) => f !== 'active_default' && f !== 'active_loans');
    const missingFields = NEW_CINET_INTEGRATION_FIELDS.filter((f) => !fields.includes(f));
    const mockData: Record<string, unknown> = { ...integration.mockData };
    delete mockData.active_default;
    delete mockData.active_loans;
    for (const key of missingFields) {
      if (!(key in mockData)) mockData[key] = DEFAULT_CINET_MOCK[key];
    }
    return { ...integration, fields: [...fields, ...missingFields], mockData };
  });

  return { ...config, customerFields: [...fieldsWithoutOld, ...newFields], hardGates, integrations };
}

/**
 * Family Wallet was removed as a product simplification: BNPL credit assessment now
 * requires age >= 18 (a plain Minimum Age hard gate with no segment exemption). Migrate
 * any config saved before that change so old LocalStorage data never resurrects the
 * segment, and backfill the CINET Assessment Status field introduced alongside it.
 */
function withoutFamilyWallet(config: Configuration): Configuration {
  const hasFamilyWallet = config.segments.some((s) => s.id === 'family_wallet');
  const existingKeys = new Set(config.customerFields.map((f) => f.key));
  const missingCinetStatus = !existingKeys.has(CINET_STATUS_FIELD.key);
  if (!hasFamilyWallet && !missingCinetStatus) return config;

  const segments = config.segments.filter((s) => s.id !== 'family_wallet');
  const routingRules = config.routingRules.filter((r) => r.targetSegmentId !== 'family_wallet');
  const customerFields = [...config.customerFields];
  if (missingCinetStatus) customerFields.push(CINET_STATUS_FIELD);

  return { ...config, segments, routingRules, customerFields };
}

const DEPRECATED_HARD_GATE_FIELD_KEYS = new Set(['sanctions_hit', 'identity_match', 'guardian_available', 'guardian_verified', 'student_product_eligible']);
const DEPRECATED_HARD_GATE_IDS = new Set(['gate_sanctions', 'gate_identity_match', 'gate_student_status', 'gate_guardian_available', 'gate_guardian_verified', 'gate_student_product_eligible']);

/**
 * Hard Gates cleanup: Sanctions Hit, Identity Match, the redundant "Student Status
 * Verified" gate (Student identification is already handled by segment routing), the
 * entire Guardian/Co-signer concept, and the Student Product Eligibility gate (replaced
 * by Student Nationality, which requires Nationality to be usable as a hard-gate input)
 * were all removed as duplicated or unnecessary rules. Identity eligibility now relies
 * solely on Civil ID Status = VALID. "Exempt Segments" was also removed in favor of a
 * single "Applies To Segments" concept (`onlySegments`). Migrate configs saved before
 * this cleanup so old LocalStorage data never resurrects any of it, so Current
 * Delinquency displays its data source as CINET, and so Nationality is hard-gate-eligible.
 */
function withoutHardGateCleanup(config: Configuration): Configuration {
  const hasDeprecatedGate = config.hardGates.some(
    (g) => DEPRECATED_HARD_GATE_IDS.has(g.id) || DEPRECATED_HARD_GATE_FIELD_KEYS.has(g.input)
  );
  const hasExemptSegments = config.hardGates.some((g) => 'exemptSegments' in (g as unknown as Record<string, unknown>));
  const hasDeprecatedField = config.customerFields.some((f) => DEPRECATED_HARD_GATE_FIELD_KEYS.has(f.key));
  const hasGuardianScoringInput = Object.values(config.scoringModels).some((m) =>
    m.inputs.some((i) => DEPRECATED_HARD_GATE_FIELD_KEYS.has(i.field))
  );
  const hasIdentityMatchIntegration = config.integrations.some((i) => i.fields.includes('identity_match'));
  const hasStudentEligibilityIntegration = config.integrations.some((i) => i.id === 'student_eligibility');
  const delinquencyField = config.customerFields.find((f) => f.key === 'current_delinquency');
  const needsDelinquencySourceRename = Boolean(delinquencyField && delinquencyField.source !== 'CINET');
  const nationalityField = config.customerFields.find((f) => f.key === 'nationality');
  const needsNationalityHardGateFlag = Boolean(nationalityField && !nationalityField.useAsHardGate);

  if (
    !hasDeprecatedGate && !hasExemptSegments && !hasDeprecatedField &&
    !hasGuardianScoringInput && !hasIdentityMatchIntegration && !hasStudentEligibilityIntegration &&
    !needsDelinquencySourceRename && !needsNationalityHardGateFlag
  ) {
    return config;
  }

  const hardGates = config.hardGates
    .filter((g) => !DEPRECATED_HARD_GATE_IDS.has(g.id) && !DEPRECATED_HARD_GATE_FIELD_KEYS.has(g.input))
    .map((g) => {
      const raw = { ...(g as unknown as Record<string, unknown>) };
      delete raw.exemptSegments;
      return raw as unknown as typeof g;
    });

  const customerFields = config.customerFields
    .filter((f) => !DEPRECATED_HARD_GATE_FIELD_KEYS.has(f.key))
    .map((f) => {
      if (f.key === 'current_delinquency') return { ...f, source: 'CINET' as const };
      if (f.key === 'nationality') return { ...f, useAsHardGate: true };
      return f;
    });

  const scoringModels: Record<string, ScoringModel> = {};
  for (const [id, model] of Object.entries(config.scoringModels)) {
    const usesGuardian = model.inputs.some((i) => DEPRECATED_HARD_GATE_FIELD_KEYS.has(i.field));
    if (id === 'student' && usesGuardian) {
      // The old Student model was guardian-weighted end to end — replace it wholesale
      // with the current default shape rather than leaving a partially-valid model.
      scoringModels[id] = { ...defaultStudentModel, inputs: defaultStudentModel.inputs.map((i) => ({ ...i })) };
      continue;
    }
    scoringModels[id] = { ...model, inputs: model.inputs.filter((i) => !DEPRECATED_HARD_GATE_FIELD_KEYS.has(i.field)) };
  }

  const integrations = config.integrations
    .filter((i) => i.id !== 'student_eligibility')
    .map((integration) => {
      if (!integration.fields.includes('identity_match')) return integration;
      const mockData = { ...integration.mockData };
      delete mockData.identity_match;
      return { ...integration, fields: integration.fields.filter((f) => f !== 'identity_match'), mockData };
    });

  const segments = config.segments.map((s) =>
    s.id === 'student' && (s.description?.toLowerCase().includes('guardian') || s.description?.toLowerCase().includes('product eligibility'))
      ? { ...s, description: 'Entry-level BNPL for 18-20 year olds — subject to Student nationality eligibility.' }
      : s
  );

  return { ...config, segments, hardGates, customerFields, scoringModels, integrations };
}

/**
 * Three related business-rule changes migrated together, since they were released as one
 * change:
 *  1. Nationality is no longer permanently barred from scoring — it may participate in a
 *     segment's scoring model exactly like any other categorical factor. It remains
 *     eligible as a hard-gate condition throughout, unchanged.
 *  2. Civil ID Status is no longer evaluated as an eligibility Hard Gate for Kuwaiti
 *     nationals — it is marked Not Applicable instead of Pass so the audit trail never
 *     shows a gate as passed when it was in fact never checked.
 *  3. Age is no longer scored a second time in the Young Adult model merely because it
 *     already determined the segment via routing; Nationality (categorical, 10%) takes
 *     its place. Established Customer gains the same Nationality factor at 10%, funded by
 *     trimming CINET Score from 30% down to 20% so the model still totals exactly 100%.
 * Migrate configs saved before this change so old LocalStorage data never resurrects the
 * old restriction or the old model shapes. Scoring models needing the redesign are
 * replaced wholesale with the current default shape (the same approach already used by
 * `withoutHardGateCleanup` for the Student model), since partially patching weights would
 * risk leaving an inconsistent hybrid the administrator never asked for.
 */
function withNationalityScoringAndCivilIdExemption(config: Configuration): Configuration {
  const nationalityField = config.customerFields.find((f) => f.key === 'nationality');
  const needsNationalityUnlock = Boolean(nationalityField?.restrictedFromScoring);

  const civilIdGate = config.hardGates.find((g) => g.id === 'gate_civil_id_status');
  const needsCivilIdSkip = Boolean(civilIdGate && !(civilIdGate.skipConditions && civilIdGate.skipConditions.length > 0));

  const yaModel = config.scoringModels.young_adult;
  const needsYaRedesign = Boolean(yaModel && (yaModel.inputs.some((i) => i.field === 'age') || !yaModel.inputs.some((i) => i.field === 'nationality')));

  const esModel = config.scoringModels.established;
  const needsEsRedesign = Boolean(esModel && !esModel.inputs.some((i) => i.field === 'nationality'));

  if (!needsNationalityUnlock && !needsCivilIdSkip && !needsYaRedesign && !needsEsRedesign) return config;

  const customerFields = needsNationalityUnlock
    ? config.customerFields.map((f) => {
        if (f.key !== 'nationality') return f;
        const raw = { ...(f as unknown as Record<string, unknown>) };
        delete raw.restrictedFromScoring;
        delete raw.restrictionNote;
        return { ...(raw as unknown as typeof f), useForScoring: true, usageLabel: 'Hard Gate / Scoring' };
      })
    : config.customerFields;

  const hardGates = needsCivilIdSkip
    ? config.hardGates.map((g) =>
        g.id === 'gate_civil_id_status'
          ? { ...g, skipConditions: CIVIL_ID_STATUS_SKIP_CONDITIONS, skipDescription: CIVIL_ID_STATUS_SKIP_DESCRIPTION }
          : g
      )
    : config.hardGates;

  const scoringModels: Record<string, ScoringModel> = { ...config.scoringModels };
  if (needsYaRedesign) {
    scoringModels.young_adult = { ...defaultYoungAdultModel, inputs: defaultYoungAdultModel.inputs.map((i) => ({ ...i })) };
  }
  if (needsEsRedesign) {
    scoringModels.established = { ...defaultEstablishedModel, inputs: defaultEstablishedModel.inputs.map((i) => ({ ...i })) };
  }

  return { ...config, customerFields, hardGates, scoringModels };
}

const DEPRECATED_BUSINESS_FIELD_KEYS = new Set([
  'self_employed',
  'has_commercial_registration',
  'commercial_registration_age_months',
  'business_sector',
]);

function omitKey<T extends Record<string, unknown>>(obj: T, key: string): T {
  if (!(key in obj)) return obj;
  const next: Record<string, unknown> = { ...obj };
  delete next[key];
  return next as T;
}

/**
 * Business BNPL was removed as a product simplification — strip any leftover
 * config from configs saved before the removal, so old LocalStorage data never
 * resurrects the segment, model, override, or its business-only fields. Any leftover
 * `overrides` entry (e.g. one that used to target `business_bnpl`) is removed wholesale
 * by `withoutReturningCustomer`, which drops the entire override-track mechanism.
 */
function withoutBusinessBnpl(config: Configuration): Configuration {
  const hasBusinessBnpl =
    'business_bnpl' in config.scoringModels ||
    'business_bnpl' in config.decisionBands ||
    config.integrations.some((i) => i.id === 'commercial_registry') ||
    config.customerFields.some((f) => DEPRECATED_BUSINESS_FIELD_KEYS.has(f.key));

  if (!hasBusinessBnpl) return config;

  return {
    ...config,
    scoringModels: omitKey(config.scoringModels, 'business_bnpl'),
    decisionBands: omitKey(config.decisionBands, 'business_bnpl'),
    integrations: config.integrations.filter((i) => i.id !== 'commercial_registry'),
    customerFields: config.customerFields.filter((f) => !DEPRECATED_BUSINESS_FIELD_KEYS.has(f.key)),
  };
}

/**
 * Returning Customer (an override track + its own scoring model, decision bands, segment
 * cap, BRDG History fields, and the BRDG Internal integration) was removed as a product
 * simplification — the prototype no longer distinguishes new vs. returning customers, and
 * BRDG's own prior repayment history is no longer used in any scoring model. Override
 * Tracks had no other user in this prototype, so the entire `overrides` mechanism is
 * removed along with it. Migrate configs saved before that change so old LocalStorage
 * data never resurrects any of it.
 */
const DEPRECATED_BRDG_HISTORY_FIELD_KEYS = new Set([
  'brdg_history_months',
  'brdg_on_time_ratio',
  'brdg_active_default',
  'previous_orders',
  'previous_paid_orders',
]);

function withoutReturningCustomer(config: Configuration): Configuration {
  const rawConfig = config as unknown as Record<string, unknown>;
  const hasReturningCustomer =
    'returning_customer' in config.scoringModels ||
    'returning_customer' in config.decisionBands ||
    config.integrations.some((i) => i.id === 'brdg_internal') ||
    config.customerFields.some((f) => DEPRECATED_BRDG_HISTORY_FIELD_KEYS.has(f.key)) ||
    'overrides' in rawConfig;
  if (!hasReturningCustomer) return config;

  const { overrides: _overrides, ...restConfig } = rawConfig;

  // Any stray `returning_customer` entry in segmentMaxLimits/creditLimitRules is dropped
  // wholesale by `withCreditLimitRulesSeparation` further down the migration chain, since
  // it rebuilds that map from `scoringModels` keys only (already cleaned up above).
  return {
    ...(restConfig as unknown as Configuration),
    scoringModels: omitKey(config.scoringModels, 'returning_customer'),
    decisionBands: omitKey(config.decisionBands, 'returning_customer'),
    integrations: config.integrations.filter((i) => i.id !== 'brdg_internal'),
    customerFields: config.customerFields.filter((f) => !DEPRECATED_BRDG_HISTORY_FIELD_KEYS.has(f.key)),
  };
}

/**
 * The Student scoring model was redesigned to remove salaried-employee factors (Monthly
 * Income, Employment Tenure, Employer Tier, Age scoring, Residency Stability) in favor of
 * Student-specific inputs (Verified Student Allowance, CINET Score, Existing Debt/Credit
 * Exposure), and a Student-only hard gate (originally Student Product Eligibility, later
 * replaced by Student Nationality — see `withoutStudentProductEligibility`) was introduced
 * rather than a scoring factor. Migrate configs saved before that change: backfill the new
 * customer fields and hard gate if missing, and replace the Student scoring model wholesale
 * if it still scores any of the now-forbidden fields (the old, since-removed Guardian
 * concept was never a scoring factor).
 */
const STUDENT_FORBIDDEN_SCORING_FIELDS = new Set([
  'monthly_income', 'employment_tenure_months', 'employer_tier', 'age', 'residency_stability_category',
  'guardian_available', 'guardian_verified',
]);

function withStudentEligibilityRedesign(config: Configuration): Configuration {
  const existingFieldKeys = new Set(config.customerFields.map((f) => f.key));
  const existingGateIds = new Set(config.hardGates.map((g) => g.id));
  const studentModel = config.scoringModels.student;
  const studentModelNeedsReplacement = Boolean(
    studentModel && studentModel.inputs.some((i) => STUDENT_FORBIDDEN_SCORING_FIELDS.has(i.field))
  );
  const needsFieldBackfill = STUDENT_BACKFILL_FIELDS.some((f) => !existingFieldKeys.has(f.key));
  const needsGateBackfill = STUDENT_ONLY_HARD_GATES.some((g) => !existingGateIds.has(g.id));

  if (!studentModelNeedsReplacement && !needsFieldBackfill && !needsGateBackfill) return config;

  const customerFields = [...config.customerFields];
  for (const f of STUDENT_BACKFILL_FIELDS) {
    if (!existingFieldKeys.has(f.key)) customerFields.push(f);
  }

  const hardGates = [...config.hardGates];
  for (const g of STUDENT_ONLY_HARD_GATES) {
    if (!existingGateIds.has(g.id)) hardGates.push(g);
  }

  const scoringModels = studentModelNeedsReplacement
    ? { ...config.scoringModels, student: { ...defaultStudentModel, inputs: defaultStudentModel.inputs.map((i) => ({ ...i })) } }
    : config.scoringModels;

  return { ...config, customerFields, hardGates, scoringModels };
}

/**
 * Decision Bands and Credit Limit Rules used to mix responsibilities: each APPROVE band
 * carried its own KWD `limit`, duplicating amounts that also lived in a separate
 * `segmentMaxLimits` map. Decision Bands now determine ONLY the Decision + Tier from the
 * score; Credit Limit Rules (Segment + Tier → amount, plus a flat Segment Maximum) are
 * the only place a monetary amount is ever configured. Migrate configs saved before that
 * change: build `creditLimitRules[modelId].tiers` from whatever `.limit` each APPROVE
 * band used to carry, carry `segmentMaximumKwd` over from the old `segmentMaxLimits`
 * map, then strip `.limit` from every band and drop `segmentMaxLimits` entirely.
 */
function withCreditLimitRulesSeparation(config: Configuration): Configuration {
  const rawConfig = config as unknown as Record<string, unknown>;
  const hasLegacySegmentMaxLimits = 'segmentMaxLimits' in rawConfig;
  const hasBandLimits = Object.values(config.decisionBands).some((bands) =>
    bands.some((b) => 'limit' in (b as unknown as Record<string, unknown>))
  );
  const missingCreditLimitRules = !('creditLimitRules' in rawConfig);
  if (!hasLegacySegmentMaxLimits && !hasBandLimits && !missingCreditLimitRules) return config;

  const legacySegmentMaxLimits = (rawConfig.segmentMaxLimits as Record<string, number> | undefined) ?? {};
  const existingCreditLimitRules = (rawConfig.creditLimitRules as Record<string, { segmentMaximumKwd: number; tiers: Record<string, number> }> | undefined) ?? {};

  const creditLimitRules: Record<string, { segmentMaximumKwd: number; tiers: Record<string, number> }> = {};
  for (const modelId of Object.keys(config.scoringModels)) {
    const bands = config.decisionBands[modelId] ?? [];
    const tiersFromBands: Record<string, number> = {};
    for (const band of bands) {
      const raw = band as unknown as Record<string, unknown>;
      if (band.outcome === 'APPROVE' && band.tier && typeof raw.limit === 'number') {
        tiersFromBands[band.tier] = raw.limit as number;
      }
    }
    const existing = existingCreditLimitRules[modelId];
    creditLimitRules[modelId] = {
      segmentMaximumKwd: existing?.segmentMaximumKwd ?? legacySegmentMaxLimits[modelId] ?? 500,
      tiers: existing?.tiers ?? tiersFromBands,
    };
  }

  const decisionBands: Configuration['decisionBands'] = {};
  for (const [modelId, bandList] of Object.entries(config.decisionBands)) {
    decisionBands[modelId] = bandList.map((b) => {
      const raw = { ...(b as unknown as Record<string, unknown>) };
      delete raw.limit;
      return raw as unknown as (typeof bandList)[number];
    });
  }

  const { segmentMaxLimits: _segmentMaxLimits, ...restConfig } = rawConfig;

  return {
    ...(restConfig as unknown as Configuration),
    decisionBands,
    creditLimitRules,
  };
}

/**
 * A past bug in `withoutFormulaCreditLimit` could silently corrupt an already-saved
 * configuration's `creditLimitRules`: every Approve tier ended up with no amount at all (an
 * empty `tiers` map), and `segmentMaximumKwd` fell back to a flat 500 for every segment
 * (wrong for Student, whose real maximum is 100). That corruption, once persisted via an
 * explicit save, survives in LocalStorage even after the migration bug itself was fixed —
 * `withCreditLimitRulesSeparation` only builds `creditLimitRules` when the key is entirely
 * absent, so a present-but-corrupted map is otherwise never revisited. Detect a segment
 * whose rule is missing an amount entirely (not a number) for a Tier its own Decision
 * Bands actually award — the unambiguous signature of that historical corruption — and
 * reset only that segment's rule back to the known-correct default.
 *
 * This must never trigger merely because a Tier's amount is 0 or negative: that is a
 * live, in-progress configuration error an administrator can produce today (editing
 * Credit Limit Rules, or removing a single Tier), and it must be surfaced by
 * `computeCreditLimit`'s runtime `configError` and `validateCreditLimitRule`'s on-screen
 * warning instead — never silently reverted out from under them on the very next read.
 * The only signature this repairs is the exact historical one: `tiers` entirely empty.
 */
function withCreditLimitRulesRepair(config: Configuration): Configuration {
  const creditLimitRules = { ...config.creditLimitRules };
  let changed = false;

  for (const modelId of Object.keys(DEFAULT_CREDIT_LIMIT_RULES)) {
    const rule = creditLimitRules[modelId];
    const isCorrupted = !rule || Object.keys(rule.tiers).length === 0;
    if (isCorrupted) {
      const fallback = DEFAULT_CREDIT_LIMIT_RULES[modelId];
      creditLimitRules[modelId] = { segmentMaximumKwd: fallback.segmentMaximumKwd, tiers: { ...fallback.tiers } };
      changed = true;
    }
  }

  if (!changed) return config;
  return { ...config, creditLimitRules };
}

const AI_EXCLUDED_FIELD_KEYS = new Set(['nationality', 'gender', 'civil_status', 'address_area', 'address_governorate']);

/**
 * The AI Manual Review Advisor (an advisory-only layer, invoked only for MANUAL_REVIEW
 * decisions) is new — backfill its default configuration for configs saved before it
 * existed, and mark every protected/demographic field `aiExcluded` so the Advisor's
 * decision package can never include them, regardless of whether the deterministic
 * engine itself already uses one of them (e.g. Nationality) for scoring/hard gates.
 */
function withAiAdvisorDefaults(config: Configuration): Configuration {
  const rawConfig = config as unknown as Record<string, unknown>;
  const needsAiAdvisor = !('aiAdvisor' in rawConfig);
  const needsFieldBackfill = config.customerFields.some((f) => AI_EXCLUDED_FIELD_KEYS.has(f.key) && !f.aiExcluded);
  if (!needsAiAdvisor && !needsFieldBackfill) return config;

  const customerFields = needsFieldBackfill
    ? config.customerFields.map((f) => (AI_EXCLUDED_FIELD_KEYS.has(f.key) ? { ...f, aiExcluded: true } : f))
    : config.customerFields;
  const aiAdvisor = needsAiAdvisor ? { ...DEFAULT_AI_ADVISOR_CONFIG } : config.aiAdvisor;

  return { ...config, customerFields, aiAdvisor };
}

/**
 * The ad-hoc `availabilityPolicy?: 'exclude_and_reweight'` flag was replaced by a single,
 * unambiguous `missingDataBehavior` dropdown ("Use Null Default" / "Exclude and Re-weight"
 * / "Manual Review") on every scoring input. Migrate configs saved before that change:
 * backfill `missingDataBehavior` on every input in every model (mapping the old
 * `availabilityPolicy` value across) and drop the deprecated field.
 */
function withMissingDataBehavior(config: Configuration): Configuration {
  const needsMigration = Object.values(config.scoringModels).some((m) =>
    m.inputs.some((i) => (i as unknown as Record<string, unknown>).missingDataBehavior === undefined)
  );
  if (!needsMigration) return config;

  const scoringModels: Record<string, ScoringModel> = {};
  for (const [id, model] of Object.entries(config.scoringModels)) {
    scoringModels[id] = {
      ...model,
      inputs: model.inputs.map((i) => {
        const raw = i as unknown as Record<string, unknown>;
        if (raw.missingDataBehavior !== undefined) return i;
        const legacyPolicy = raw.availabilityPolicy;
        const { availabilityPolicy: _drop, ...rest } = raw;
        return {
          ...rest,
          missingDataBehavior: legacyPolicy === 'exclude_and_reweight' ? 'exclude_and_reweight' : 'use_null_default',
        } as unknown as typeof i;
      }),
    };
  }
  return { ...config, scoringModels };
}

/**
 * Segments became fully dynamic/configurable: every Segment now carries `code`, `active`,
 * `priority`, `routingMode`, `createdAt`, and `updatedAt`, and Segment age ranges are the
 * sole source of truth for routing (see `withRoutingRulesFromSegments` below) rather than
 * a separately hand-edited Routing Rules list. Backfill any segment saved before this
 * change with sensible defaults derived from its own existing data — this never touches
 * `id`, `name`, `scoringModelId`, or any of its attached Scoring Model / Decision Bands /
 * Credit Limit Rule configuration.
 */
function withDynamicSegmentFields(config: Configuration): Configuration {
  const needsBackfill = config.segments.some((s) => {
    const raw = s as unknown as Record<string, unknown>;
    return (
      raw.code === undefined ||
      raw.active === undefined ||
      raw.priority === undefined ||
      raw.routingMode === undefined ||
      raw.createdAt === undefined ||
      raw.updatedAt === undefined
    );
  });
  if (!needsBackfill) return config;

  const byAgeAscending = [...config.segments].sort((a, b) => (a.ageMin ?? 0) - (b.ageMin ?? 0));
  const priorityBySegmentId = new Map(byAgeAscending.map((s, idx) => [s.id, (idx + 1) * 10]));

  const segments = config.segments.map((s) => {
    const raw = s as unknown as Record<string, unknown>;
    return {
      ...s,
      code: (raw.code as string | undefined) ?? s.id,
      active: (raw.active as boolean | undefined) ?? true,
      priority: (raw.priority as number | undefined) ?? priorityBySegmentId.get(s.id) ?? 50,
      routingMode: (raw.routingMode as Segment['routingMode'] | undefined) ?? 'AGE_RANGE',
      createdAt: (raw.createdAt as string | undefined) ?? config.createdAt,
      updatedAt: (raw.updatedAt as string | undefined) ?? config.updatedAt,
    };
  });
  return { ...config, segments };
}

/**
 * Segment routing is now configured directly on each Segment, never duplicated in a
 * separately-edited Routing Rules list — this is the ONLY place `routingRules` is ever
 * produced, applied unconditionally (not gated behind a "needs migration" check) on every
 * load so it can never silently drift out of sync with the segments it describes.
 * `routingEngine.ts` is unchanged — it still just evaluates whatever rules it's handed.
 */
function withRoutingRulesFromSegments(config: Configuration): Configuration {
  return { ...config, routingRules: buildRoutingRulesFromSegments(config.segments) };
}

const CONFIG_KEY = 'brdgpay.configurations';
const HISTORY_KEY = 'brdgpay.decisionHistory';
const INTEGRATIONS_KEY_PREFIX = 'brdgpay.integrationOverrides';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getConfigurations(): Configuration[] {
  const configs = readJson<Configuration[]>(CONFIG_KEY, []);
  if (configs.length === 0) {
    const seeded = buildDefaultConfiguration();
    writeJson(CONFIG_KEY, [seeded]);
    return [seeded];
  }
  const migrated = configs
    .map(withPreapprovedDefaults)
    .map(withoutBusinessBnpl)
    .map(withGlobalSettingsDefaults)
    .map(withCinetRefresh)
    .map(withoutFamilyWallet)
    .map(withoutFormulaCreditLimit)
    .map(withoutReturningCustomer)
    .map(withStudentEligibilityRedesign)
    .map(withoutHardGateCleanup)
    .map(withNationalityScoringAndCivilIdExemption)
    .map(withCreditLimitRulesSeparation)
    .map(withCreditLimitRulesRepair)
    .map(withMissingDataBehavior)
    .map(withAiAdvisorDefaults)
    .map(withDynamicSegmentFields)
    .map(withRoutingRulesFromSegments);
  // Persist once so a repaired/migrated shape (e.g. corrupted Credit Limit Rules healed by
  // withCreditLimitRulesRepair) becomes the actual saved state, not just an in-memory patch
  // recomputed on every read — otherwise raw LocalStorage would keep the corrupted data forever.
  if (JSON.stringify(migrated) !== JSON.stringify(configs)) {
    writeJson(CONFIG_KEY, migrated);
  }
  return migrated;
}

export function saveConfigurations(configs: Configuration[]): void {
  writeJson(CONFIG_KEY, configs);
}

export function getActiveConfiguration(): Configuration {
  const configs = getConfigurations();
  const active = configs.find((c) => c.status === 'ACTIVE');
  return active ?? configs[0];
}

export function getConfigurationById(id: string): Configuration | undefined {
  return getConfigurations().find((c) => c.id === id);
}

export function upsertConfiguration(config: Configuration): void {
  const configs = getConfigurations();
  const idx = configs.findIndex((c) => c.id === config.id);
  const updated = { ...config, updatedAt: new Date().toISOString() };
  if (idx === -1) {
    configs.push(updated);
  } else {
    configs[idx] = updated;
  }
  saveConfigurations(configs);
}

export function activateConfiguration(id: string): void {
  const configs = getConfigurations().map((c) => {
    if (c.id === id) return { ...c, status: 'ACTIVE' as const, updatedAt: new Date().toISOString() };
    if (c.status === 'ACTIVE') return { ...c, status: 'RETIRED' as const, updatedAt: new Date().toISOString() };
    return c;
  });
  saveConfigurations(configs);
}

export function retireConfiguration(id: string): void {
  const configs = getConfigurations().map((c) =>
    c.id === id ? { ...c, status: 'RETIRED' as const, updatedAt: new Date().toISOString() } : c
  );
  saveConfigurations(configs);
}

function nextVersionLabel(configs: Configuration[]): string {
  const numbers = configs
    .map((c) => parseInt(c.versionLabel.replace(/[^0-9]/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  const max = numbers.length ? Math.max(...numbers) : 0;
  return `v${max + 1}`;
}

export function createDraftFromActive(): Configuration {
  const active = getActiveConfiguration();
  const configs = getConfigurations();
  const draft: Configuration = {
    ...active,
    id: uuidv4(),
    versionLabel: nextVersionLabel(configs),
    status: 'DRAFT',
    notes: `Cloned from ${active.versionLabel}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveConfigurations([...configs, draft]);
  return draft;
}

export function cloneConfiguration(id: string): Configuration {
  const source = getConfigurationById(id);
  const configs = getConfigurations();
  if (!source) throw new Error('Configuration not found');
  const clone: Configuration = {
    ...source,
    id: uuidv4(),
    versionLabel: nextVersionLabel(configs),
    status: 'DRAFT',
    notes: `Cloned from ${source.versionLabel}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveConfigurations([...configs, clone]);
  return clone;
}

export function deleteConfiguration(id: string): void {
  const configs = getConfigurations().filter((c) => c.id !== id);
  saveConfigurations(configs);
}

// --- Decision history -----------------------------------------------------

export function getDecisionHistory(): DecisionResult[] {
  return readJson<DecisionResult[]>(HISTORY_KEY, []);
}

export function saveDecision(result: DecisionResult): void {
  const history = getDecisionHistory();
  history.unshift(result);
  writeJson(HISTORY_KEY, history.slice(0, 500));
}

export function getDecisionById(id: string): DecisionResult | undefined {
  return getDecisionHistory().find((d) => d.id === id);
}

export function clearDecisionHistory(): void {
  writeJson(HISTORY_KEY, []);
}

// --- Import / export -------------------------------------------------------

export function exportConfigurationJson(config: Configuration): string {
  return JSON.stringify(config, null, 2);
}

export function importConfigurationJson(json: string): Configuration {
  const parsed = JSON.parse(json) as Configuration;
  if (!parsed.id || !parsed.segments) throw new Error('Invalid configuration file');
  const sanitized = withRoutingRulesFromSegments(
    withDynamicSegmentFields(
      withAiAdvisorDefaults(
        withMissingDataBehavior(
          withCreditLimitRulesSeparation(
            withNationalityScoringAndCivilIdExemption(
              withoutHardGateCleanup(
                withStudentEligibilityRedesign(
                  withoutReturningCustomer(
                    withoutFormulaCreditLimit(
                      withoutFamilyWallet(
                        withCinetRefresh(withGlobalSettingsDefaults(withoutBusinessBnpl(withPreapprovedDefaults(parsed))))
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  );
  const withId: Configuration = { ...sanitized, id: uuidv4(), status: 'DRAFT', updatedAt: new Date().toISOString() };
  const configs = getConfigurations();
  saveConfigurations([...configs, withId]);
  return withId;
}

export function exportDecisionJson(result: DecisionResult): string {
  return JSON.stringify(result, null, 2);
}

export function resetDemoConfiguration(): Configuration {
  const seeded = buildDefaultConfiguration();
  saveConfigurations([seeded]);
  clearDecisionHistory();
  return seeded;
}

export const INTEGRATIONS_STORAGE_KEY = INTEGRATIONS_KEY_PREFIX;
