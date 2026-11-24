import { useState } from 'react';
import { useConfigStore } from '../hooks/ConfigContext';
import { Card, Button } from '../components/ui';
import { isModelValid, totalWeight } from '../engine/normalization';
import type { MissingDataBehavior, NormalizationMethod, ScoringInputConfig } from '../models/configuration';

export const METHODS: NormalizationMethod[] = ['linear', 'linear_inverted', 'banded', 'categorical', 'boolean'];

export const MISSING_DATA_BEHAVIORS: { value: MissingDataBehavior; label: string }[] = [
  { value: 'use_null_default', label: 'Use Null Default' },
  { value: 'exclude_and_reweight', label: 'Exclude and Re-weight' },
  { value: 'manual_review', label: 'Manual Review' },
];

export const NULL_DEFAULT_TOOLTIP =
  'Normalized fallback score (0–1) used when this input is unavailable. Example: Null Default 0.20 with Weight 25% contributes 5 points.';

export function BandsEditor({ input, onChange }: { input: ScoringInputConfig; onChange: (bands: ScoringInputConfig['bands']) => void }) {
  const bands = input.bands ?? [];
  const patchBand = (idx: number, patch: Partial<{ min: number; max: number; score: number }>) => {
    onChange(bands.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };
  return (
    <div className="stack-sm">
      {bands.map((b, idx) => (
        <div key={idx} className="flex-row">
          <input type="number" value={b.min} style={{ width: 90 }} onChange={(e) => patchBand(idx, { min: Number(e.target.value) })} />
          <span className="muted">to</span>
          <input type="number" value={b.max} style={{ width: 90 }} onChange={(e) => patchBand(idx, { max: Number(e.target.value) })} />
          <span className="muted">→ score</span>
          <input type="number" step="0.05" value={b.score} style={{ width: 80 }} onChange={(e) => patchBand(idx, { score: Number(e.target.value) })} />
          <Button size="sm" variant="danger" onClick={() => onChange(bands.filter((_, i) => i !== idx))}>×</Button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...bands, { min: 0, max: 100, score: 0.5 }])}>+ Add Band</Button>
    </div>
  );
}

export function CategoriesEditor({ input, onChange }: { input: ScoringInputConfig; onChange: (categories: Record<string, number>) => void }) {
  const categories = input.categories ?? {};
  const entries = Object.entries(categories);
  const [newKey, setNewKey] = useState('');
  return (
    <div className="stack-sm">
      {entries.map(([key, score]) => (
        <div key={key} className="flex-row">
          <input type="text" value={key} style={{ width: 140 }} readOnly />
          <input
            type="number" step="0.05" value={score} style={{ width: 90 }}
            onChange={(e) => onChange({ ...categories, [key]: Number(e.target.value) })}
          />
          <Button size="sm" variant="danger" onClick={() => {
            const next = { ...categories };
            delete next[key];
            onChange(next);
          }}>×</Button>
        </div>
      ))}
      <div className="flex-row">
        <input type="text" placeholder="new category" value={newKey} style={{ width: 140 }} onChange={(e) => setNewKey(e.target.value)} />
        <Button size="sm" onClick={() => { if (newKey) { onChange({ ...categories, [newKey]: 0.5 }); setNewKey(''); } }}>+ Add</Button>
      </div>
    </div>
  );
}

export default function ScoringInputsPage() {
  const { activeConfig, updateActiveConfig } = useConfigStore();
  const modelIds = Object.keys(activeConfig.scoringModels);
  const [modelId, setModelId] = useState(modelIds[0]);
  const model = activeConfig.scoringModels[modelId];

  const eligibleFields = activeConfig.customerFields.filter((f) => f.useForScoring && !f.restrictedFromScoring);

  const patchInput = (id: string, patch: Partial<ScoringInputConfig>) => {
    updateActiveConfig((cfg) => ({
      ...cfg,
      scoringModels: {
        ...cfg.scoringModels,
        [modelId]: { ...cfg.scoringModels[modelId], inputs: cfg.scoringModels[modelId].inputs.map((i) => (i.id === id ? { ...i, ...patch } : i)) },
      },
    }));
  };

  const addInput = () => {
    updateActiveConfig((cfg) => ({
      ...cfg,
      scoringModels: {
        ...cfg.scoringModels,
        [modelId]: {
          ...cfg.scoringModels[modelId],
          inputs: [...cfg.scoringModels[modelId].inputs, {
            id: `input_${Date.now()}`, field: eligibleFields[0]?.key ?? '', displayName: eligibleFields[0]?.displayName ?? 'New Input',
            method: 'linear', weight: 0, nullDefault: 0.3, enabled: true, min: 0, max: 1, missingDataBehavior: 'use_null_default' as const,
          }],
        },
      },
    }));
  };

  const removeInput = (id: string) => {
    updateActiveConfig((cfg) => ({
      ...cfg,
      scoringModels: { ...cfg.scoringModels, [modelId]: { ...cfg.scoringModels[modelId], inputs: cfg.scoringModels[modelId].inputs.filter((i) => i.id !== id) } },
    }));
  };

  if (!model) return null;

  const total = totalWeight(model.inputs);
  const valid = isModelValid(model.inputs);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Scoring Inputs</h1>
        <p className="page-subtitle">Configure the normalized, weighted inputs for each scoring model. Enabled weights must total exactly 100%.</p>
      </div>

      <div className="tabs">
        {modelIds.map((id) => (
          <div key={id} className={`tab${id === modelId ? ' active' : ''}`} onClick={() => setModelId(id)}>{activeConfig.scoringModels[id].name}</div>
        ))}
      </div>

      <Card
        title={`${model.name} — Total Weight: ${total}%`}
        desc={valid ? 'Model is valid and can be activated.' : 'Weights must total 100% for this model to be usable — currently disabled.'}
        actions={<Button size="sm" onClick={addInput}>+ Add Input</Button>}
      >
        {!valid && (
          <p className="small-note" style={{ marginBottom: 14, borderColor: 'var(--red)', color: 'var(--red)' }}>
            ⚠ Total scoring weights must equal 100% (currently {total}%). Reduce other factor weights before activating this factor.
          </p>
        )}
        <div className="stack-sm">
          {model.inputs.map((input) => (
            <div key={input.id} className="card" style={{ boxShadow: 'none' }}>
              <div className="flex-between" style={{ marginBottom: 10 }}>
                <label className="checkbox-row">
                  <input type="checkbox" checked={input.enabled} onChange={(e) => patchInput(input.id, { enabled: e.target.checked })} />
                  <strong>{input.displayName}</strong>
                </label>
                <Button size="sm" variant="danger" onClick={() => removeInput(input.id)}>Remove</Button>
              </div>
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
                  <select value={input.method} onChange={(e) => patchInput(input.id, { method: e.target.value as NormalizationMethod })}>
                    {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">Weight (%)</label>
                  <input type="number" value={input.weight} onChange={(e) => patchInput(input.id, { weight: Number(e.target.value) })} />
                </div>
                <div className="field-group">
                  <label className="field-label">Missing Data Behavior</label>
                  <select
                    value={input.missingDataBehavior}
                    onChange={(e) => patchInput(input.id, { missingDataBehavior: e.target.value as MissingDataBehavior })}
                  >
                    {MISSING_DATA_BEHAVIORS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                </div>
              </div>

              {input.missingDataBehavior === 'use_null_default' && (
                <div className="field-group" style={{ maxWidth: 220, marginTop: 10 }}>
                  <label className="field-label" title={NULL_DEFAULT_TOOLTIP}>
                    Null Default (0–1) <span className="muted" style={{ cursor: 'help' }} title={NULL_DEFAULT_TOOLTIP}>ⓘ</span>
                  </label>
                  <input
                    type="number" step="0.05" min={0} max={1} value={input.nullDefault}
                    onChange={(e) => patchInput(input.id, { nullDefault: Number(e.target.value) })}
                  />
                  <p className="card-desc" style={{ marginTop: 4 }}>{NULL_DEFAULT_TOOLTIP}</p>
                </div>
              )}

              {(input.method === 'linear' || input.method === 'linear_inverted') && (
                <div className="grid grid-2">
                  <div className="field-group">
                    <label className="field-label">Min</label>
                    <input type="number" value={input.min ?? 0} onChange={(e) => patchInput(input.id, { min: Number(e.target.value) })} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Max</label>
                    <input type="number" value={input.max ?? 1} onChange={(e) => patchInput(input.id, { max: Number(e.target.value) })} />
                  </div>
                </div>
              )}

              {input.method === 'banded' && (
                <div className="field-group">
                  <label className="field-label">Bands</label>
                  <BandsEditor input={input} onChange={(bands) => patchInput(input.id, { bands })} />
                </div>
              )}

              {input.method === 'categorical' && (
                <div className="field-group">
                  <label className="field-label">Categories</label>
                  <CategoriesEditor input={input} onChange={(categories) => patchInput(input.id, { categories })} />
                </div>
              )}

              {input.method === 'boolean' && (
                <div className="grid grid-2">
                  <div className="field-group">
                    <label className="field-label">True Score</label>
                    <input type="number" step="0.05" value={input.booleanScores?.trueScore ?? 1} onChange={(e) => patchInput(input.id, { booleanScores: { trueScore: Number(e.target.value), falseScore: input.booleanScores?.falseScore ?? 0 } })} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">False Score</label>
                    <input type="number" step="0.05" value={input.booleanScores?.falseScore ?? 0} onChange={(e) => patchInput(input.id, { booleanScores: { trueScore: input.booleanScores?.trueScore ?? 1, falseScore: Number(e.target.value) } })} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
