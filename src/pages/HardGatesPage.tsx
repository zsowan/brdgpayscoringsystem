import { useState } from 'react';
import { useConfigStore } from '../hooks/ConfigContext';
import { Card, Button } from '../components/ui';
import { ConditionEditor } from '../components/ConditionEditor';
import { validateHardGate } from '../engine/creditLimitEngine';
import type { ComparisonOperator, HardGateRule } from '../models/configuration';

const OPERATORS: ComparisonOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'is_null', 'is_not_null'];
const OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  eq: 'equals', neq: 'not equals', gt: 'greater than', gte: 'at least', lt: 'less than', lte: 'at most',
  in: 'in', not_in: 'not in', is_null: 'is unavailable', is_not_null: 'is available',
};

export default function HardGatesPage() {
  const { activeConfig, updateActiveConfig } = useConfigStore();
  const [segmentId, setSegmentId] = useState(activeConfig.segments[0]?.id ?? '');
  const currentSegmentId = activeConfig.segments.some((s) => s.id === segmentId) ? segmentId : activeConfig.segments[0]?.id ?? '';

  const patch = (id: string, p: Partial<HardGateRule>) => {
    updateActiveConfig((cfg) => ({ ...cfg, hardGates: cfg.hardGates.map((g) => (g.id === id ? { ...g, ...p } : g)) }));
  };

  const addRule = () => {
    updateActiveConfig((cfg) => ({
      ...cfg,
      hardGates: [...cfg.hardGates, {
        id: `gate_${Date.now()}`, name: 'New Gate', enabled: true, priority: (cfg.hardGates.length + 1) * 10,
        input: cfg.customerFields[0]?.key ?? '', operator: 'eq', value: '', reasonCode: 'NEW_REASON_CODE',
        // Segment-specific by default — the administrator can broaden it to Common by
        // checking every segment's box (or clearing them all) below.
        onlySegments: [currentSegmentId],
      }],
    }));
  };

  const removeRule = (id: string) => {
    updateActiveConfig((cfg) => ({ ...cfg, hardGates: cfg.hardGates.filter((g) => g.id !== id) }));
  };

  // restrictedFromScoring only bars a field from weighted SCORING (e.g. Nationality) — it
  // remains fully eligible as a categorical hard-gate/eligibility condition.
  const gateFields = activeConfig.customerFields.filter((f) => f.useAsHardGate);
  const rulesForSegment = [...activeConfig.hardGates]
    .filter((g) => !g.onlySegments || g.onlySegments.length === 0 || g.onlySegments.includes(currentSegmentId))
    .sort((a, b) => a.priority - b.priority);

  const toggleAppliesTo = (rule: HardGateRule, segId: string) => {
    const set = new Set(rule.onlySegments ?? []);
    if (set.has(segId)) set.delete(segId); else set.add(segId);
    patch(rule.id, { onlySegments: Array.from(set) });
  };

  const toggleSkipCondition = (rule: HardGateRule) => {
    const hasSkip = Boolean(rule.skipConditions && rule.skipConditions.length > 0);
    patch(rule.id, hasSkip ? { skipConditions: [], skipDescription: undefined } : { skipConditions: [{ field: 'nationality', operator: 'eq', value: 'KW' }], skipDescription: '' });
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Hard Gates</h1>
        <p className="page-subtitle">
          Customer → Segment Routing → Segment = X → X Hard Gates → if any applicable gate fails, REJECT; if unavailable, follow
          its configured behavior; if all applicable gates pass, continue to Scoring. Gates run in priority order. A gate
          whose "Skip When" condition matches is marked Not Applicable rather than Passed — it was never evaluated.
        </p>
      </div>

      <div className="tabs">
        {activeConfig.segments.map((seg) => (
          <div key={seg.id} className={`tab${seg.id === currentSegmentId ? ' active' : ''}`} onClick={() => setSegmentId(seg.id)}>{seg.name}</div>
        ))}
      </div>

      <Card
        title={`${activeConfig.segments.find((s) => s.id === currentSegmentId)?.name ?? ''} Hard Gates`}
        desc="Gates with no segments checked below are Common — shown and evaluated for every segment. Checking one or more segments restricts a gate to only those segments."
        actions={<Button size="sm" onClick={addRule}>+ Add Gate</Button>}
      >
        {rulesForSegment.length === 0 && <p className="muted">No hard gates apply to this segment yet.</p>}
        <div className="stack-sm">
          {rulesForSegment.map((rule) => {
            const field = activeConfig.customerFields.find((f) => f.key === rule.input);
            const appliesTo = rule.onlySegments ?? [];
            const isCommon = appliesTo.length === 0;
            const hasSkip = Boolean(rule.skipConditions && rule.skipConditions.length > 0);
            const validation = validateHardGate(rule);
            return (
              <div key={rule.id} className="card" style={{ boxShadow: 'none' }}>
                <div className="flex-between" style={{ marginBottom: 10 }}>
                  <div className="flex-row" style={{ flexWrap: 'wrap' }}>
                    <input type="text" value={rule.name} style={{ width: 220, fontWeight: 600 }} onChange={(e) => patch(rule.id, { name: e.target.value })} />
                    <label className="checkbox-row">
                      <input type="checkbox" checked={rule.enabled} onChange={(e) => patch(rule.id, { enabled: e.target.checked })} />
                      Enabled
                    </label>
                    <span className="muted">Priority</span>
                    <input type="number" style={{ width: 70 }} value={rule.priority} onChange={(e) => patch(rule.id, { priority: Number(e.target.value) })} />
                    <span className={`badge ${isCommon ? 'badge-neutral' : 'badge-approve'}`}>{isCommon ? 'Common (All Segments)' : 'Segment-Specific'}</span>
                  </div>
                  <Button size="sm" variant="danger" onClick={() => removeRule(rule.id)}>Remove</Button>
                </div>

                {!validation.valid && (
                  <p className="small-note" style={{ marginBottom: 10, borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ {validation.issues.join('; ')}</p>
                )}

                <p className="small-note" style={{ marginBottom: 10 }}>Source: {field?.source ?? '—'}</p>

                <div className="field-group">
                  <label className="field-label">Condition</label>
                  <div className="flex-row" style={{ flexWrap: 'wrap' }}>
                    <select value={rule.input} onChange={(e) => patch(rule.id, { input: e.target.value })}>
                      {gateFields.map((f) => <option key={f.key} value={f.key}>{f.displayName}</option>)}
                    </select>
                    <select value={rule.operator} onChange={(e) => patch(rule.id, { operator: e.target.value as ComparisonOperator })}>
                      {OPERATORS.map((op) => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
                    </select>
                    {field?.type === 'boolean' ? (
                      <select value={String(rule.value)} onChange={(e) => patch(rule.id, { value: e.target.value === 'true' })}>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : field?.type === 'enum' && field.options ? (
                      <select value={String(rule.value ?? '')} onChange={(e) => patch(rule.id, { value: e.target.value })}>
                        {field.options.map((o) => <option key={o} value={o}>{field.optionLabels?.[o] ?? o}</option>)}
                      </select>
                    ) : (
                      <input type={field?.type === 'number' ? 'number' : 'text'} value={String(rule.value ?? '')} onChange={(e) => patch(rule.id, { value: field?.type === 'number' ? Number(e.target.value) : e.target.value })} />
                    )}
                  </div>
                </div>

                <div className="grid grid-2" style={{ marginTop: 10 }}>
                  <div className="field-group">
                    <label className="field-label">Applies To Segments</label>
                    <div className="pill-btn-group">
                      {activeConfig.segments.map((seg) => (
                        <label key={seg.id} className="checkbox-row">
                          <input type="checkbox" checked={appliesTo.includes(seg.id)} onChange={() => toggleAppliesTo(rule, seg.id)} />
                          {seg.name}
                        </label>
                      ))}
                    </div>
                    <p className="card-desc" style={{ marginTop: 4 }}>
                      {isCommon ? 'Applies to all segments (Common).' : `Applies only to: ${activeConfig.segments.filter((s) => appliesTo.includes(s.id)).map((s) => s.name).join(', ')}.`}
                      {' '}Leave all unchecked to apply this rule to all segments.
                    </p>
                  </div>
                  <div className="field-group">
                    <label className="field-label">If condition fails</label>
                    <div className="kpi-value" style={{ fontSize: 16 }}><span className="badge badge-reject">REJECT</span></div>
                    <label className="field-label" style={{ marginTop: 10 }}>Reason Code</label>
                    <input type="text" className="mono" value={rule.reasonCode} onChange={(e) => patch(rule.id, { reasonCode: e.target.value })} />
                  </div>
                </div>

                <div className="field-group" style={{ marginTop: 10 }}>
                  <label className="field-label">Unavailable Data Reason Code (optional)</label>
                  <p className="card-desc" style={{ marginTop: 4, marginBottom: 4 }}>
                    When the input itself is missing (e.g. an integration timeout), the gate does not silently pass or fail — it is
                    marked indeterminate and routed to manual review, recorded with this reason code instead of the fail reason code above.
                    Leave blank to use the default (<span className="mono">DATA_UNAVAILABLE</span>) — this is optional and never blocks saving.
                  </p>
                  <input
                    type="text"
                    className="mono"
                    style={{ maxWidth: 320 }}
                    value={rule.dataUnavailableReasonCode ?? ''}
                    placeholder="DATA_UNAVAILABLE (default) — e.g. CINET_DELINQUENCY_DATA_UNAVAILABLE"
                    onChange={(e) => patch(rule.id, { dataUnavailableReasonCode: e.target.value || undefined })}
                  />
                </div>

                <div className="field-group" style={{ marginTop: 10 }}>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={hasSkip} onChange={() => toggleSkipCondition(rule)} />
                    Skip this gate entirely (mark Not Applicable) when a condition matches
                  </label>
                  <p className="card-desc" style={{ marginTop: 4, marginBottom: 4 }}>
                    Example: Civil ID Status skipped for Kuwaiti customers — the gate is reported as "Not Applicable", never as "Passed".
                  </p>
                  {hasSkip && (
                    <>
                      <ConditionEditor
                        conditions={rule.skipConditions ?? []}
                        fields={activeConfig.customerFields}
                        onChange={(next) => patch(rule.id, { skipConditions: next })}
                      />
                      <label className="field-label" style={{ marginTop: 10 }}>Not Applicable Reason (shown in audit trail)</label>
                      <input
                        type="text"
                        style={{ maxWidth: 420 }}
                        value={rule.skipDescription ?? ''}
                        placeholder="e.g. Kuwaiti customer – Civil ID Status eligibility check not required"
                        onChange={(e) => patch(rule.id, { skipDescription: e.target.value })}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
