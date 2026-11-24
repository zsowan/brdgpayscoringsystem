import { useEffect, useState } from 'react';
import { useConfigStore } from '../hooks/ConfigContext';
import { Card, Button, KpiTile } from '../components/ui';
import { ConditionEditor } from '../components/ConditionEditor';
import { ScoreBar } from '../components/ScoreBar';
import { BandsEditor, CategoriesEditor, METHODS, MISSING_DATA_BEHAVIORS, NULL_DEFAULT_TOOLTIP } from './ScoringInputsPage';
import {
  validateHardGate,
  validateBandCoverage,
  validateBandTiers,
  validateCreditLimitRule,
  getTierCreditLimit,
  computeCreditLimit,
} from '../engine/creditLimitEngine';
import { isModelValid, totalWeight } from '../engine/normalization';
import { computeSegmentConfigStatus, SEGMENT_STATUS_BADGE_CLASS } from '../engine/segmentEngine';
import { formatKwd, formatPercent } from '../utils/format';
import type {
  Configuration,
  ComparisonOperator,
  CustomerDataField,
  HardGateRule,
  ScoringInputConfig,
  DecisionBandDef,
  DecisionOutcome,
} from '../models/configuration';

const OPERATORS: ComparisonOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'is_null', 'is_not_null'];
const OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  eq: 'equals', neq: 'not equals', gt: 'greater than', gte: 'at least', lt: 'less than', lte: 'at most',
  in: 'in', not_in: 'not in', is_null: 'is unavailable', is_not_null: 'is available',
};
const OUTCOMES: DecisionOutcome[] = ['REJECT', 'MANUAL_REVIEW', 'APPROVE'];

/** A business-readable version of a Hard Gate's condition, e.g. "Age at least 18". */
function describeGateCondition(rule: HardGateRule, fields: CustomerDataField[]): string {
  const field = fields.find((f) => f.key === rule.input);
  const label = field?.displayName ?? rule.input;
  if (rule.operator === 'is_null') return `${label} is unavailable`;
  if (rule.operator === 'is_not_null') return `${label} is available`;
  let valueText = String(rule.value ?? '');
  if (field?.type === 'boolean') valueText = rule.value ? 'true' : 'false';
  else if (Array.isArray(rule.value)) valueText = rule.value.join(', ');
  else if (field?.type === 'enum' && field.optionLabels?.[valueText]) valueText = field.optionLabels[valueText];
  return `${label} ${OPERATOR_LABELS[rule.operator]} ${valueText}`;
}

function ValidationLine({ label, ok, issues }: { label: string; ok: boolean; issues: string[] }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={{ color: ok ? 'var(--green)' : 'var(--red)' }}>{ok ? '✓' : '✗'}</span>{' '}
      <strong>{label}:</strong>{' '}
      {ok ? <span className="muted">Valid</span> : <span style={{ color: 'var(--red)' }}>{issues.join('; ')}</span>}
    </div>
  );
}

export default function DecisionEnginePage() {
  const { activeConfig, updateActiveConfig } = useConfigStore();
  const [draft, setDraft] = useState<Configuration>(activeConfig);
  const [segmentId, setSegmentId] = useState(activeConfig.segments[0]?.id ?? '');
  const [pendingSegmentId, setPendingSegmentId] = useState<string | null>(null);
  const [expandedGates, setExpandedGates] = useState<Set<string>>(new Set());
  const [expandedInputs, setExpandedInputs] = useState<Set<string>>(new Set());
  const [previewTierOverride, setPreviewTierOverride] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  // `updatedAt` is bookkeeping metadata re-stamped fresh by `upsertConfiguration` on every
  // save — it must never factor into "unsaved changes", or the banner would never clear
  // after a genuine, successful save (the just-persisted timestamp never loops back into
  // this component's local draft).
  const isDirty = JSON.stringify({ ...draft, updatedAt: null }) !== JSON.stringify({ ...activeConfig, updatedAt: null });

  // Re-sync the draft whenever the persisted configuration actually changes underneath
  // this page (e.g. Reset Demo Data, importing a configuration elsewhere) — but never
  // clobber the administrator's own in-progress, unsaved edits.
  useEffect(() => {
    if (!isDirty) setDraft(activeConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConfig.id, activeConfig.updatedAt]);

  // Segment tabs are generated entirely from configured segments — no segment name or
  // count is ever hard-coded. Inactive segments are hidden by default (they never route
  // new customers) but their configuration is fully preserved and can still be reviewed
  // via "Show Inactive Segments".
  const visibleSegments = [...draft.segments]
    .filter((s) => s.active || showInactive)
    .sort((a, b) => a.priority - b.priority);
  const currentSegmentId = visibleSegments.some((s) => s.id === segmentId) ? segmentId : visibleSegments[0]?.id ?? '';
  const currentSegment = draft.segments.find((s) => s.id === currentSegmentId);
  const scoringModelId = currentSegment?.scoringModelId ?? null;
  const model = scoringModelId ? draft.scoringModels[scoringModelId] : null;
  const bands = scoringModelId ? [...(draft.decisionBands[scoringModelId] ?? [])].sort((a, b) => a.min - b.min) : [];
  const creditRule = scoringModelId ? draft.creditLimitRules[scoringModelId] : undefined;
  const gatesForSegment = [...draft.hardGates]
    .filter((g) => !g.onlySegments || g.onlySegments.length === 0 || g.onlySegments.includes(currentSegmentId))
    .sort((a, b) => a.priority - b.priority);

  const handleSave = () => {
    updateActiveConfig(() => draft);
  };
  const handleDiscard = () => {
    setDraft(activeConfig);
  };
  const selectSegment = (id: string) => {
    if (id === currentSegmentId) return;
    if (isDirty) setPendingSegmentId(id);
    else setSegmentId(id);
  };
  const resolvePendingSwitch = (action: 'save' | 'discard' | 'cancel') => {
    if (action === 'cancel') { setPendingSegmentId(null); return; }
    if (action === 'save') updateActiveConfig(() => draft);
    else setDraft(activeConfig);
    if (pendingSegmentId) setSegmentId(pendingSegmentId);
    setPendingSegmentId(null);
  };

  // ============================================================
  // 1. Eligibility Rules (Hard Gates)
  // ============================================================
  const patchGate = (id: string, p: Partial<HardGateRule>) => {
    setDraft((cfg) => ({ ...cfg, hardGates: cfg.hardGates.map((g) => (g.id === id ? { ...g, ...p } : g)) }));
  };
  const addGate = () => {
    setDraft((cfg) => ({
      ...cfg,
      hardGates: [...cfg.hardGates, {
        id: `gate_${Date.now()}`, name: 'New Eligibility Rule', enabled: true, priority: (cfg.hardGates.length + 1) * 10,
        input: cfg.customerFields[0]?.key ?? '', operator: 'eq', value: '', reasonCode: 'NEW_REASON_CODE',
        onlySegments: [currentSegmentId],
      }],
    }));
  };
  const removeGate = (id: string, name: string) => {
    if (!window.confirm(`Remove eligibility rule "${name}"? This cannot be undone once saved.`)) return;
    setDraft((cfg) => ({ ...cfg, hardGates: cfg.hardGates.filter((g) => g.id !== id) }));
  };
  const toggleAppliesTo = (rule: HardGateRule, segId: string) => {
    const set = new Set(rule.onlySegments ?? []);
    if (set.has(segId)) set.delete(segId); else set.add(segId);
    patchGate(rule.id, { onlySegments: Array.from(set) });
  };
  const toggleSkipCondition = (rule: HardGateRule) => {
    const hasSkip = Boolean(rule.skipConditions && rule.skipConditions.length > 0);
    patchGate(rule.id, hasSkip
      ? { skipConditions: [], skipDescription: undefined }
      : { skipConditions: [{ field: 'nationality', operator: 'eq', value: 'KW' }], skipDescription: '' });
  };
  const toggleGateExpanded = (id: string) => {
    setExpandedGates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const gateFields = draft.customerFields.filter((f) => f.useAsHardGate);

  // ============================================================
  // 2. Scoring Model
  // ============================================================
  const eligibleFields = draft.customerFields.filter((f) => f.useForScoring && !f.restrictedFromScoring);
  const patchInput = (id: string, p: Partial<ScoringInputConfig>) => {
    if (!scoringModelId) return;
    setDraft((cfg) => ({
      ...cfg,
      scoringModels: {
        ...cfg.scoringModels,
        [scoringModelId]: { ...cfg.scoringModels[scoringModelId], inputs: cfg.scoringModels[scoringModelId].inputs.map((i) => (i.id === id ? { ...i, ...p } : i)) },
      },
    }));
  };
  const addInput = () => {
    if (!scoringModelId) return;
    setDraft((cfg) => ({
      ...cfg,
      scoringModels: {
        ...cfg.scoringModels,
        [scoringModelId]: {
          ...cfg.scoringModels[scoringModelId],
          inputs: [...cfg.scoringModels[scoringModelId].inputs, {
            id: `input_${Date.now()}`, field: eligibleFields[0]?.key ?? '', displayName: eligibleFields[0]?.displayName ?? 'New Factor',
            method: 'linear', weight: 0, nullDefault: 0.3, enabled: true, min: 0, max: 1, missingDataBehavior: 'use_null_default' as const,
          }],
        },
      },
    }));
  };
  const removeInput = (id: string, name: string) => {
    if (!scoringModelId) return;
    if (!window.confirm(`Remove scoring factor "${name}"? This cannot be undone once saved.`)) return;
    setDraft((cfg) => ({
      ...cfg,
      scoringModels: { ...cfg.scoringModels, [scoringModelId]: { ...cfg.scoringModels[scoringModelId], inputs: cfg.scoringModels[scoringModelId].inputs.filter((i) => i.id !== id) } },
    }));
  };
  const toggleInputExpanded = (id: string) => {
    setExpandedInputs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ============================================================
  // 3. Decision Bands
  // ============================================================
  const patchBand = (id: string, p: Partial<DecisionBandDef>) => {
    if (!scoringModelId) return;
    setDraft((cfg) => ({ ...cfg, decisionBands: { ...cfg.decisionBands, [scoringModelId]: cfg.decisionBands[scoringModelId].map((b) => (b.id === id ? { ...b, ...p } : b)) } }));
  };
  const addBand = () => {
    if (!scoringModelId) return;
    setDraft((cfg) => ({
      ...cfg,
      decisionBands: { ...cfg.decisionBands, [scoringModelId]: [...(cfg.decisionBands[scoringModelId] ?? []), { id: `band_${Date.now()}`, min: 0, max: 0.1, outcome: 'MANUAL_REVIEW' as DecisionOutcome }] },
    }));
  };
  const removeBand = (id: string) => {
    if (!scoringModelId) return;
    if (!window.confirm('Remove this decision band? This cannot be undone once saved.')) return;
    setDraft((cfg) => ({ ...cfg, decisionBands: { ...cfg.decisionBands, [scoringModelId]: cfg.decisionBands[scoringModelId].filter((b) => b.id !== id) } }));
  };

  // ============================================================
  // 4. Credit Limits
  // ============================================================
  const patchSegmentMax = (value: number) => {
    if (!scoringModelId) return;
    setDraft((cfg) => ({ ...cfg, creditLimitRules: { ...cfg.creditLimitRules, [scoringModelId]: { ...cfg.creditLimitRules[scoringModelId], segmentMaximumKwd: value } } }));
  };
  const patchTierLimit = (tier: string, value: number) => {
    if (!scoringModelId) return;
    setDraft((cfg) => ({
      ...cfg,
      creditLimitRules: { ...cfg.creditLimitRules, [scoringModelId]: { ...cfg.creditLimitRules[scoringModelId], tiers: { ...cfg.creditLimitRules[scoringModelId]?.tiers, [tier]: value } } },
    }));
  };
  const patchGlobalMax = (value: number) => {
    setDraft((cfg) => ({ ...cfg, globalSettings: { ...cfg.globalSettings, globalMaxBnplLimit: value } }));
  };

  // ============================================================
  // Validation (surfaced close to each section; never silently swallowed)
  // ============================================================
  const gateValidations = gatesForSegment.map((g) => ({ id: g.id, ...validateHardGate(g) }));
  const gatesValid = gateValidations.every((v) => v.valid);
  const gateIssues = gateValidations.flatMap((v) => v.issues);

  const modelTotalWeight = model ? totalWeight(model.inputs) : 0;
  const modelValid = model ? isModelValid(model.inputs) : true;

  const coverageValidation = validateBandCoverage(bands);
  const tierValidation = validateBandTiers(bands);
  const bandsValid = coverageValidation.valid && tierValidation.valid;
  const bandIssues = [...coverageValidation.issues, ...tierValidation.issues];

  const approveBands = bands.filter((b) => b.outcome === 'APPROVE' && b.tier);
  const nonApproveBands = bands.filter((b) => b.outcome !== 'APPROVE');
  const approveTierNames = approveBands.map((b) => b.tier as string);
  const creditValidation = creditRule
    ? validateCreditLimitRule(creditRule, draft.globalSettings.globalMaxBnplLimit, approveTierNames)
    : { valid: true, issues: [] as string[] };

  // ============================================================
  // Summary + explanatory credit-limit preview
  // ============================================================
  const enabledGateCount = gatesForSegment.filter((g) => g.enabled).length;
  const enabledFactorCount = model ? model.inputs.filter((i) => i.enabled).length : 0;
  const segmentConfigStatus = currentSegmentId ? computeSegmentConfigStatus(draft, currentSegmentId) : { status: 'INCOMPLETE' as const, issues: [] };
  const previewTier = (previewTierOverride && approveTierNames.includes(previewTierOverride))
    ? previewTierOverride
    : approveTierNames[approveTierNames.length - 1] ?? null;
  const previewTierLimit = scoringModelId ? getTierCreditLimit(draft.creditLimitRules, scoringModelId, previewTier) : null;
  const previewCalc = previewTier
    ? computeCreditLimit(previewTierLimit, creditRule?.segmentMaximumKwd ?? 0, draft.globalSettings.globalMaxBnplLimit, previewTier)
    : null;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Decision Engine Configuration</h1>
        <p className="page-subtitle">
          Segment → Eligibility → Scoring → Decision → Credit Limit. Configure how customers in each segment are
          evaluated, scored, assigned a decision tier, and granted a credit limit.
        </p>
      </div>

      {isDirty && (
        <Card>
          <div className="flex-between">
            <span>⚠ <strong>Unsaved Changes</strong> — edits on this page are staged until you save them.</span>
            <div className="flex-row">
              <Button onClick={handleDiscard}>Discard</Button>
              <Button variant="primary" onClick={handleSave}>Save Changes</Button>
            </div>
          </div>
        </Card>
      )}

      <Card title="Global Policy" desc="Applies across every segment — configured once here, never repeated per segment.">
        <div className="field-group" style={{ maxWidth: 260 }}>
          <label className="field-label">Global Maximum BNPL Limit (KWD)</label>
          <input type="number" value={draft.globalSettings.globalMaxBnplLimit} onChange={(e) => patchGlobalMax(Number(e.target.value))} />
          <p className="card-desc" style={{ marginTop: 4 }}>Absolute maximum automatic BNPL exposure allowed for any customer, in any segment.</p>
        </div>
        {draft.globalSettings.globalMaxBnplLimit <= 0 && (
          <p className="small-note" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ Global Maximum BNPL Limit must be greater than 0.</p>
        )}
      </Card>

      <div className="flex-between" style={{ flexWrap: 'wrap' }}>
        <div className="tabs">
          {visibleSegments.map((seg) => {
            const segStatus = computeSegmentConfigStatus(draft, seg.id);
            return (
              <div key={seg.id} className={`tab${seg.id === currentSegmentId ? ' active' : ''}`} onClick={() => selectSegment(seg.id)}>
                {seg.name}{!seg.active && ' (Inactive)'}
                <span className={`badge ${SEGMENT_STATUS_BADGE_CLASS[segStatus.status]}`} style={{ marginLeft: 6, fontSize: 10 }}>{segStatus.status}</span>
              </div>
            );
          })}
        </div>
        {draft.segments.some((s) => !s.active) && (
          <label className="checkbox-row" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show Inactive Segments
          </label>
        )}
      </div>

      {visibleSegments.length === 0 && (
        <Card><p className="muted">No active segments configured. Add or activate a segment on the Segments page.</p></Card>
      )}

      {pendingSegmentId && (
        <Card>
          <div className="flex-between" style={{ flexWrap: 'wrap' }}>
            <span>
              ⚠ You have unsaved changes for <strong>{currentSegment?.name}</strong>. Save them before switching to{' '}
              <strong>{draft.segments.find((s) => s.id === pendingSegmentId)?.name}</strong>?
            </span>
            <div className="flex-row">
              <Button size="sm" onClick={() => resolvePendingSwitch('cancel')}>Cancel</Button>
              <Button size="sm" onClick={() => resolvePendingSwitch('discard')}>Discard &amp; Switch</Button>
              <Button size="sm" variant="primary" onClick={() => resolvePendingSwitch('save')}>Save &amp; Switch</Button>
            </div>
          </div>
        </Card>
      )}

      <Card title={`${currentSegment?.name ?? ''} — How This Segment Works`}>
        <div className="grid grid-4">
          <KpiTile label="Eligibility Rules" value={`${enabledGateCount} enabled`} sub={`${gatesForSegment.length} total`} />
          <KpiTile label="Scoring Factors" value={`${enabledFactorCount} enabled`} sub={`${model?.inputs.length ?? 0} total`} />
          <KpiTile label="Total Weight" value={`${modelTotalWeight}%`} sub={modelValid ? 'Valid' : 'Must equal 100%'} />
          <KpiTile label="Decision Bands" value={`${bands.length}`} />
          <KpiTile label="Segment Maximum Credit Limit" value={formatKwd(creditRule?.segmentMaximumKwd ?? 0)} />
          <KpiTile label="Config Status" value={segmentConfigStatus.status} sub={segmentConfigStatus.issues[0]} />
        </div>
      </Card>

      <div className="flex-row" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
        {['1. Eligibility', '2. Scoring', '3. Decision Band', '4. Credit Limit'].map((step, idx, arr) => (
          <span key={step} className="flex-row" style={{ gap: 8 }}>
            <span className="badge badge-neutral">{step}</span>
            {idx < arr.length - 1 && <span className="muted">→</span>}
          </span>
        ))}
      </div>

      {/* ============================================================ */}
      {/* 1. ELIGIBILITY RULES                                          */}
      {/* ============================================================ */}
      <Card
        title="1. Eligibility Rules"
        desc={`Hard Gates — rules that must be satisfied before the customer can proceed to scoring.`}
        actions={<Button size="sm" onClick={addGate}>+ Add Eligibility Rule</Button>}
      >
        {!gatesValid && (
          <p className="small-note" style={{ marginBottom: 12, borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ {gateIssues.join('; ')}</p>
        )}
        {gatesForSegment.length === 0 && <p className="muted">No eligibility rules apply to this segment yet.</p>}
        <div className="stack-sm">
          {gatesForSegment.map((rule) => {
            const field = draft.customerFields.find((f) => f.key === rule.input);
            const appliesTo = rule.onlySegments ?? [];
            const isCommon = appliesTo.length === 0;
            const hasSkip = Boolean(rule.skipConditions && rule.skipConditions.length > 0);
            const expanded = expandedGates.has(rule.id);
            const validation = validateHardGate(rule);
            return (
              <div key={rule.id} className="card" style={{ boxShadow: 'none' }}>
                <div className="flex-between" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                  <div className="flex-row" style={{ flexWrap: 'wrap' }}>
                    <input type="text" value={rule.name} style={{ width: 200, fontWeight: 600 }} onChange={(e) => patchGate(rule.id, { name: e.target.value })} />
                    <span className="muted">{describeGateCondition(rule, draft.customerFields)}</span>
                    <span className="badge badge-reject" style={{ fontSize: 11 }}>If Failed → Reject</span>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={rule.enabled} onChange={(e) => patchGate(rule.id, { enabled: e.target.checked })} />
                      Enabled
                    </label>
                    <span className={`badge ${isCommon ? 'badge-neutral' : 'badge-approve'}`}>{isCommon ? 'Common' : 'Segment-Specific'}</span>
                  </div>
                  <div className="flex-row">
                    <Button size="sm" onClick={() => toggleGateExpanded(rule.id)}>{expanded ? 'Hide Details ▴' : 'Details ▾'}</Button>
                    <Button size="sm" variant="danger" onClick={() => removeGate(rule.id, rule.name)}>Remove</Button>
                  </div>
                </div>

                {!validation.valid && (
                  <p className="small-note" style={{ marginBottom: 10, borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ {validation.issues.join('; ')}</p>
                )}

                {expanded && (
                  <>
                    <p className="small-note" style={{ marginBottom: 10 }}>Source: {field?.source ?? '—'} · Technical field: <span className="mono">{rule.input}</span></p>

                    <div className="field-group">
                      <label className="field-label">Condition</label>
                      <div className="flex-row" style={{ flexWrap: 'wrap' }}>
                        <select value={rule.input} onChange={(e) => patchGate(rule.id, { input: e.target.value })}>
                          {gateFields.map((f) => <option key={f.key} value={f.key}>{f.displayName}</option>)}
                        </select>
                        <select value={rule.operator} onChange={(e) => patchGate(rule.id, { operator: e.target.value as ComparisonOperator })}>
                          {OPERATORS.map((op) => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
                        </select>
                        {field?.type === 'boolean' ? (
                          <select value={String(rule.value)} onChange={(e) => patchGate(rule.id, { value: e.target.value === 'true' })}>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : field?.type === 'enum' && field.options ? (
                          <select value={String(rule.value ?? '')} onChange={(e) => patchGate(rule.id, { value: e.target.value })}>
                            {field.options.map((o) => <option key={o} value={o}>{field.optionLabels?.[o] ?? o}</option>)}
                          </select>
                        ) : (
                          <input type={field?.type === 'number' ? 'number' : 'text'} value={String(rule.value ?? '')} onChange={(e) => patchGate(rule.id, { value: field?.type === 'number' ? Number(e.target.value) : e.target.value })} />
                        )}
                      </div>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 10 }}>
                      <div className="field-group">
                        <label className="field-label">Priority</label>
                        <input type="number" style={{ width: 90 }} value={rule.priority} onChange={(e) => patchGate(rule.id, { priority: Number(e.target.value) })} />
                      </div>
                      <div className="field-group">
                        <label className="field-label">Reason Code</label>
                        <input type="text" className="mono" value={rule.reasonCode} onChange={(e) => patchGate(rule.id, { reasonCode: e.target.value })} />
                      </div>
                    </div>

                    <div className="field-group" style={{ marginTop: 10 }}>
                      <label className="field-label">Applies To Segments</label>
                      <div className="pill-btn-group">
                        {draft.segments.map((seg) => (
                          <label key={seg.id} className="checkbox-row">
                            <input type="checkbox" checked={appliesTo.includes(seg.id)} onChange={() => toggleAppliesTo(rule, seg.id)} />
                            {seg.name}
                          </label>
                        ))}
                      </div>
                      <p className="card-desc" style={{ marginTop: 4 }}>
                        {isCommon ? 'Applies to all segments (Common).' : `Applies only to: ${draft.segments.filter((s) => appliesTo.includes(s.id)).map((s) => s.name).join(', ')}.`}
                        {' '}Leave all unchecked to apply this rule to all segments.
                      </p>
                    </div>

                    <div className="field-group" style={{ marginTop: 10 }}>
                      <label className="field-label">Unavailable Data Reason Code (optional)</label>
                      <p className="card-desc" style={{ marginTop: 4, marginBottom: 4 }}>
                        When the input itself is missing, the gate is never marked Pass or Fail — it is marked Indeterminate/Unavailable and
                        the decision is routed to Manual Review, recorded with this reason code. Leave blank to use the default
                        (<span className="mono">DATA_UNAVAILABLE</span>) — this is optional and never blocks saving.
                      </p>
                      <input
                        type="text" className="mono" style={{ maxWidth: 320 }} value={rule.dataUnavailableReasonCode ?? ''}
                        placeholder="DATA_UNAVAILABLE (default) — e.g. CINET_DELINQUENCY_DATA_UNAVAILABLE"
                        onChange={(e) => patchGate(rule.id, { dataUnavailableReasonCode: e.target.value || undefined })}
                      />
                    </div>

                    <div className="field-group" style={{ marginTop: 10 }}>
                      <label className="checkbox-row">
                        <input type="checkbox" checked={hasSkip} onChange={() => toggleSkipCondition(rule)} />
                        Skip this gate entirely (mark Not Applicable) when a condition matches
                      </label>
                      {hasSkip && (
                        <>
                          <ConditionEditor conditions={rule.skipConditions ?? []} fields={draft.customerFields} onChange={(next) => patchGate(rule.id, { skipConditions: next })} />
                          <label className="field-label" style={{ marginTop: 10 }}>Not Applicable Reason</label>
                          <input
                            type="text" style={{ maxWidth: 420 }} value={rule.skipDescription ?? ''}
                            placeholder="e.g. Kuwaiti customer – Civil ID Status eligibility check not required"
                            onChange={(e) => patchGate(rule.id, { skipDescription: e.target.value })}
                          />
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* ============================================================ */}
      {/* 2. SCORING MODEL                                              */}
      {/* ============================================================ */}
      <Card
        title="2. Scoring Model"
        desc="Factors used to calculate the customer's credit score."
        actions={<Button size="sm" onClick={addInput} disabled={!model}>+ Add Scoring Factor</Button>}
      >
        {!model ? (
          <p className="muted">This segment has no scoring model (no credit line).</p>
        ) : (
          <>
            <p className="card-title" style={{ marginBottom: 4 }}>
              Total Weight: {modelTotalWeight}%{' '}
              {modelValid ? <span className="badge badge-approve">Valid</span> : <span className="badge badge-reject">Must equal 100%</span>}
            </p>
            {!modelValid && (
              <p className="small-note" style={{ marginBottom: 12, borderColor: 'var(--red)', color: 'var(--red)' }}>
                ⚠ Enabled weights total {modelTotalWeight}%, not 100% — this model is disabled until corrected.
              </p>
            )}
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Factor</th><th>Method</th><th>Weight</th><th>Missing Data Behavior</th><th>Enabled</th><th></th></tr></thead>
                <tbody>
                  {model.inputs.map((input) => (
                    <tr key={input.id}>
                      <td>{input.displayName}</td>
                      <td className="mono">{input.method}</td>
                      <td>{input.weight}%</td>
                      <td>{MISSING_DATA_BEHAVIORS.find((b) => b.value === input.missingDataBehavior)?.label}</td>
                      <td><input type="checkbox" checked={input.enabled} onChange={(e) => patchInput(input.id, { enabled: e.target.checked })} /></td>
                      <td className="flex-row">
                        <Button size="sm" onClick={() => toggleInputExpanded(input.id)}>{expandedInputs.has(input.id) ? 'Hide ▴' : 'Details ▾'}</Button>
                        <Button size="sm" variant="danger" onClick={() => removeInput(input.id, input.displayName)}>Remove</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="stack-sm" style={{ marginTop: 12 }}>
              {model.inputs.filter((i) => expandedInputs.has(i.id)).map((input) => (
                <div key={input.id} className="card" style={{ boxShadow: 'none' }}>
                  <p className="card-title" style={{ marginBottom: 8 }}>{input.displayName} — Advanced Configuration</p>
                  <div className="grid grid-4">
                    <div className="field-group">
                      <label className="field-label">Field</label>
                      <select value={input.field} onChange={(e) => {
                        const f = eligibleFields.find((ff) => ff.key === e.target.value);
                        patchInput(input.id, { field: e.target.value, displayName: f?.displayName ?? input.displayName });
                      }}>
                        {eligibleFields.map((f) => <option key={f.key} value={f.key}>{f.displayName}</option>)}
                      </select>
                    </div>
                    <div className="field-group">
                      <label className="field-label">Method</label>
                      <select value={input.method} onChange={(e) => patchInput(input.id, { method: e.target.value as ScoringInputConfig['method'] })}>
                        {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="field-group">
                      <label className="field-label">Weight (%)</label>
                      <input type="number" value={input.weight} onChange={(e) => patchInput(input.id, { weight: Number(e.target.value) })} />
                    </div>
                    <div className="field-group">
                      <label className="field-label">Missing Data Behavior</label>
                      <select value={input.missingDataBehavior} onChange={(e) => patchInput(input.id, { missingDataBehavior: e.target.value as ScoringInputConfig['missingDataBehavior'] })}>
                        {MISSING_DATA_BEHAVIORS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                      </select>
                    </div>
                  </div>

                  {input.missingDataBehavior === 'use_null_default' && (
                    <div className="field-group" style={{ maxWidth: 220, marginTop: 10 }}>
                      <label className="field-label" title={NULL_DEFAULT_TOOLTIP}>Null Default (0–1) <span className="muted" title={NULL_DEFAULT_TOOLTIP}>ⓘ</span></label>
                      <input type="number" step="0.05" min={0} max={1} value={input.nullDefault} onChange={(e) => patchInput(input.id, { nullDefault: Number(e.target.value) })} />
                    </div>
                  )}

                  {(input.method === 'linear' || input.method === 'linear_inverted') && (
                    <div className="grid grid-2">
                      <div className="field-group"><label className="field-label">Min</label><input type="number" value={input.min ?? 0} onChange={(e) => patchInput(input.id, { min: Number(e.target.value) })} /></div>
                      <div className="field-group"><label className="field-label">Max</label><input type="number" value={input.max ?? 1} onChange={(e) => patchInput(input.id, { max: Number(e.target.value) })} /></div>
                    </div>
                  )}

                  {input.method === 'banded' && (
                    <div className="field-group"><label className="field-label">Bands</label><BandsEditor input={input} onChange={(bands) => patchInput(input.id, { bands })} /></div>
                  )}

                  {input.method === 'categorical' && (
                    <div className="field-group"><label className="field-label">Categories</label><CategoriesEditor input={input} onChange={(categories) => patchInput(input.id, { categories })} /></div>
                  )}

                  {input.method === 'boolean' && (
                    <div className="grid grid-2">
                      <div className="field-group"><label className="field-label">True Score</label><input type="number" step="0.05" value={input.booleanScores?.trueScore ?? 1} onChange={(e) => patchInput(input.id, { booleanScores: { trueScore: Number(e.target.value), falseScore: input.booleanScores?.falseScore ?? 0 } })} /></div>
                      <div className="field-group"><label className="field-label">False Score</label><input type="number" step="0.05" value={input.booleanScores?.falseScore ?? 0} onChange={(e) => patchInput(input.id, { booleanScores: { trueScore: input.booleanScores?.trueScore ?? 1, falseScore: Number(e.target.value) } })} /></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ============================================================ */}
      {/* 3. DECISION BANDS                                             */}
      {/* ============================================================ */}
      <Card
        title="3. Decision Bands"
        desc="Convert the final score into a decision and risk tier. Bands must fully cover 0%–100% with no gaps or overlaps."
        actions={<Button size="sm" onClick={addBand} disabled={!scoringModelId}>+ Add Band</Button>}
      >
        {!scoringModelId ? (
          <p className="muted">This segment has no scoring model, so no Decision Bands apply.</p>
        ) : (
          <>
            {!bandsValid && (
              <p className="small-note" style={{ marginBottom: 14, borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ {bandIssues.join('; ')}</p>
            )}
            {bandsValid && bands.length > 0 && <ScoreBar bands={bands} score={0} />}
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead><tr><th>Min Score</th><th>Max Score</th><th>Decision</th><th>Tier</th><th>Action</th></tr></thead>
                <tbody>
                  {bands.map((b) => (
                    <tr key={b.id}>
                      <td><input type="number" step="1" min={0} max={100} value={Math.round(b.min * 1000) / 10} style={{ width: 80 }} onChange={(e) => patchBand(b.id, { min: Number(e.target.value) / 100 })} /> %</td>
                      <td><input type="number" step="1" min={0} max={100} value={Math.round(b.max * 1000) / 10} style={{ width: 80 }} onChange={(e) => patchBand(b.id, { max: Number(e.target.value) / 100 })} /> %</td>
                      <td>
                        <select
                          value={b.outcome}
                          onChange={(e) => {
                            const outcome = e.target.value as DecisionOutcome;
                            patchBand(b.id, { outcome, tier: outcome === 'APPROVE' ? b.tier : undefined });
                          }}
                        >
                          {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td><input type="text" value={b.tier ?? ''} style={{ width: 90 }} disabled={b.outcome !== 'APPROVE'} onChange={(e) => patchBand(b.id, { tier: e.target.value })} /></td>
                      <td><Button size="sm" variant="danger" onClick={() => removeBand(b.id)}>×</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small-note" style={{ marginTop: 10 }}>
              Decision Bands never carry a monetary amount — Credit Limits (below) is the only place a KWD amount is configured.
            </p>
          </>
        )}
      </Card>

      {/* ============================================================ */}
      {/* 4. CREDIT LIMITS                                              */}
      {/* ============================================================ */}
      <Card title="4. Credit Limits" desc="Configure the monetary credit limit granted for each approved tier.">
        {!creditRule ? (
          <p className="muted">This segment has no scoring model, so no Credit Limits apply.</p>
        ) : (
          <>
            {!creditValidation.valid && (
              <p className="small-note" style={{ marginBottom: 14, borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ {creditValidation.issues.join('; ')}</p>
            )}
            <div className="grid grid-2">
              <div>
                <p className="card-title" style={{ marginBottom: 8, fontSize: 14 }}>Tier Credit Limits</p>
                <div className="stack-sm">
                  {approveBands.map((b) => (
                    <div key={b.id} className="flex-row" style={{ alignItems: 'center', gap: 10 }}>
                      <span className="badge badge-approve" style={{ minWidth: 64, textAlign: 'center' }}>{b.tier}</span>
                      <span className="muted" title={`Score ${formatPercent(b.min * 100)} – ${formatPercent(Math.min(1, b.max) * 100)}`}>→</span>
                      <input type="number" style={{ width: 100 }} value={creditRule.tiers[b.tier as string] ?? 0} onChange={(e) => patchTierLimit(b.tier as string, Number(e.target.value))} />
                      <span className="muted">KWD</span>
                    </div>
                  ))}
                  {nonApproveBands.map((b) => (
                    <div key={b.id} className="flex-row" style={{ alignItems: 'center', gap: 10 }}>
                      <span className={`badge ${b.outcome === 'REJECT' ? 'badge-reject' : 'badge-review'}`} style={{ minWidth: 64, textAlign: 'center' }}>
                        {b.outcome === 'REJECT' ? 'Reject' : 'Manual Review'}
                      </span>
                      <span className="muted">→</span>
                      <span className="muted">{b.outcome === 'REJECT' ? '0 KWD' : 'No Limit'}</span>
                    </div>
                  ))}
                </div>
                <div className="field-group" style={{ maxWidth: 260, marginTop: 16 }}>
                  <label className="field-label">Segment Maximum Credit Limit (KWD)</label>
                  <input type="number" value={creditRule.segmentMaximumKwd} onChange={(e) => patchSegmentMax(Number(e.target.value))} />
                  <p className="card-desc" style={{ marginTop: 4 }}>Maximum credit limit for this segment, regardless of tier.</p>
                </div>
              </div>

              <div>
                <p className="card-title" style={{ marginBottom: 8, fontSize: 14 }}>How the Final Limit Is Calculated</p>
                <p className="card-desc" style={{ marginBottom: 8 }}>
                  Final Credit Limit = MIN( Tier Credit Limit, Segment Maximum Credit Limit, Global Maximum BNPL Limit )
                </p>
                {approveTierNames.length > 0 && (
                  <>
                    <div className="field-group" style={{ maxWidth: 200 }}>
                      <label className="field-label">Preview Tier</label>
                      <select value={previewTier ?? ''} onChange={(e) => setPreviewTierOverride(e.target.value)}>
                        {approveTierNames.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="table-wrap" style={{ marginTop: 8 }}>
                      <table className="data-table">
                        <tbody>
                          <tr><td>{previewTier} Limit</td><td>{formatKwd(previewCalc?.tierCreditLimit ?? null)}</td></tr>
                          <tr><td>Segment Maximum</td><td>{formatKwd(previewCalc?.segmentMaxLimit ?? 0)}</td></tr>
                          <tr><td>Global Maximum</td><td>{formatKwd(previewCalc?.globalMaxLimit ?? 0)}</td></tr>
                          <tr><td><strong>Final Maximum Allowed</strong></td><td><strong>{formatKwd(previewCalc?.finalLimit ?? 0)}</strong></td></tr>
                        </tbody>
                      </table>
                    </div>
                    {previewCalc?.configError && (
                      <p className="small-note" style={{ marginTop: 8, borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ {previewCalc.configErrorReason}</p>
                    )}
                  </>
                )}
                <p className="small-note" style={{ marginTop: 10 }}>This panel is explanatory only — it reads the values configured to the left; it is not a separate configuration source.</p>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* ============================================================ */}
      {/* VALIDATION SUMMARY                                            */}
      {/* ============================================================ */}
      <Card title="Validation Summary" desc={`Checked before saving ${currentSegment?.name ?? 'this segment'}'s configuration.`}>
        <ValidationLine label="Eligibility Rules" ok={gatesValid} issues={gateIssues} />
        <ValidationLine label="Scoring Model" ok={modelValid} issues={[`Total Weight = ${modelTotalWeight}% (must be 100%)`]} />
        <ValidationLine label="Decision Bands" ok={bandsValid} issues={bandIssues} />
        <ValidationLine label="Credit Limits" ok={creditValidation.valid} issues={creditValidation.issues} />
        <div className="flex-row" style={{ marginTop: 12 }}>
          <Button onClick={handleDiscard} disabled={!isDirty}>Discard</Button>
          <Button variant="primary" onClick={handleSave} disabled={!isDirty}>Save Changes</Button>
        </div>
      </Card>
    </div>
  );
}
