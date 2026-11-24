import { useState } from 'react';
import { useConfigStore } from '../hooks/ConfigContext';
import { Card, Button } from '../components/ui';
import { validateBandCoverage, validateBandTiers } from '../engine/creditLimitEngine';
import { ScoreBar } from '../components/ScoreBar';
import { formatPercent } from '../utils/format';
import type { DecisionBandDef, DecisionOutcome } from '../models/configuration';

const OUTCOMES: DecisionOutcome[] = ['REJECT', 'MANUAL_REVIEW', 'APPROVE'];

export default function DecisionBandsPage() {
  const { activeConfig, updateActiveConfig } = useConfigStore();
  const modelIds = Object.keys(activeConfig.scoringModels);
  const [modelId, setModelId] = useState(modelIds[0]);
  const bands = activeConfig.decisionBands[modelId] ?? [];

  const patchBand = (id: string, patch: Partial<DecisionBandDef>) => {
    updateActiveConfig((cfg) => ({
      ...cfg,
      decisionBands: { ...cfg.decisionBands, [modelId]: cfg.decisionBands[modelId].map((b) => (b.id === id ? { ...b, ...patch } : b)) },
    }));
  };

  const addBand = () => {
    updateActiveConfig((cfg) => ({
      ...cfg,
      decisionBands: { ...cfg.decisionBands, [modelId]: [...(cfg.decisionBands[modelId] ?? []), { id: `band_${Date.now()}`, min: 0, max: 0.1, outcome: 'MANUAL_REVIEW' }] },
    }));
  };

  const removeBand = (id: string) => {
    updateActiveConfig((cfg) => ({ ...cfg, decisionBands: { ...cfg.decisionBands, [modelId]: cfg.decisionBands[modelId].filter((b) => b.id !== id) } }));
  };

  const coverageValidation = validateBandCoverage(bands);
  const tierValidation = validateBandTiers(bands);
  const validation = {
    valid: coverageValidation.valid && tierValidation.valid,
    issues: [...coverageValidation.issues, ...tierValidation.issues],
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Decision Bands</h1>
        <p className="page-subtitle">
          Decision Bands convert the final normalized score into a decision and risk tier. Monetary credit limits are
          configured separately under Credit Limit Rules. Bands must fully cover 0%–100% with no gaps or overlaps, and
          each segment's bands are configured independently.
        </p>
      </div>

      <div className="tabs">
        {modelIds.map((id) => (
          <div key={id} className={`tab${id === modelId ? ' active' : ''}`} onClick={() => setModelId(id)}>{activeConfig.scoringModels[id].name}</div>
        ))}
      </div>

      <Card title={`${activeConfig.scoringModels[modelId]?.name} Bands`} actions={<Button size="sm" onClick={addBand}>+ Add Band</Button>}>
        {!validation.valid && (
          <p className="small-note" style={{ marginBottom: 14, borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ {validation.issues.join('; ')}</p>
        )}
        {validation.valid && bands.length > 0 && <ScoreBar bands={bands} score={0} />}
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead><tr><th>Min Score</th><th>Max Score</th><th>Outcome</th><th>Tier</th><th>Action</th></tr></thead>
            <tbody>
              {[...bands].sort((a, b) => a.min - b.min).map((b) => (
                <tr key={b.id}>
                  <td>
                    <input
                      type="number" step="1" min={0} max={100} value={Math.round(b.min * 1000) / 10} style={{ width: 80 }}
                      onChange={(e) => patchBand(b.id, { min: Number(e.target.value) / 100 })}
                    /> %
                  </td>
                  <td>
                    <input
                      type="number" step="1" min={0} max={100} value={Math.round(b.max * 1000) / 10} style={{ width: 80 }}
                      onChange={(e) => patchBand(b.id, { max: Number(e.target.value) / 100 })}
                    /> %
                  </td>
                  <td>
                    <select
                      value={b.outcome}
                      onChange={(e) => {
                        const outcome = e.target.value as DecisionOutcome;
                        // REJECT/MANUAL_REVIEW bands must not carry a Tier — clear it automatically
                        // when switching away from APPROVE so the UI can never create that state.
                        patchBand(b.id, { outcome, tier: outcome === 'APPROVE' ? b.tier : undefined });
                      }}
                    >
                      {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
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
          Example: {formatPercent(45)} – {formatPercent(60)} → APPROVE / Tier C. Internally the engine stores this as
          0.45–0.60; percentages here are for business readability only.
        </p>
      </Card>
    </div>
  );
}
