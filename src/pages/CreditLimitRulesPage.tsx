import { useConfigStore } from '../hooks/ConfigContext';
import { Card } from '../components/ui';
import { formatKwd, formatPercent } from '../utils/format';
import { validateCreditLimitRule } from '../engine/creditLimitEngine';

export default function CreditLimitRulesPage() {
  const { activeConfig, updateActiveConfig } = useConfigStore();
  const modelIds = Object.keys(activeConfig.scoringModels);

  const patchSegmentMax = (modelId: string, value: number) => {
    updateActiveConfig((cfg) => ({
      ...cfg,
      creditLimitRules: {
        ...cfg.creditLimitRules,
        [modelId]: { ...cfg.creditLimitRules[modelId], segmentMaximumKwd: value },
      },
    }));
  };

  const patchTierLimit = (modelId: string, tier: string, value: number) => {
    updateActiveConfig((cfg) => ({
      ...cfg,
      creditLimitRules: {
        ...cfg.creditLimitRules,
        [modelId]: {
          ...cfg.creditLimitRules[modelId],
          tiers: { ...cfg.creditLimitRules[modelId]?.tiers, [tier]: value },
        },
      },
    }));
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Credit Limit Rules</h1>
        <p className="page-subtitle">
          Configure the credit amount assigned to each Tier within each customer Segment. This is the ONLY place
          credit limit amounts are configured — Decision Bands determine the decision and tier, never an amount. The
          final credit limit is the lowest of the Tier Credit Limit, Segment Maximum Credit Limit, and Global Maximum
          BNPL Limit.
        </p>
      </div>

      <Card title="Global Maximum BNPL Limit" desc="A hard ceiling applied to every approved decision, across every segment.">
        <div className="field-group" style={{ maxWidth: 220 }}>
          <label className="field-label">Global Maximum BNPL Limit (KWD)</label>
          <input
            type="number"
            value={activeConfig.globalSettings.globalMaxBnplLimit}
            onChange={(e) => updateActiveConfig((cfg) => ({ ...cfg, globalSettings: { ...cfg.globalSettings, globalMaxBnplLimit: Number(e.target.value) } }))}
          />
        </div>
        {activeConfig.globalSettings.globalMaxBnplLimit <= 0 && (
          <p className="small-note" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ Global Maximum BNPL Limit must be greater than 0.</p>
        )}
        <p className="small-note">Currently applied: {formatKwd(activeConfig.globalSettings.globalMaxBnplLimit)}</p>
      </Card>

      <div className="grid grid-2">
        {modelIds.map((modelId) => {
          const bands = [...(activeConfig.decisionBands[modelId] ?? [])].sort((a, b) => a.min - b.min);
          const approveBands = bands.filter((b) => b.outcome === 'APPROVE' && b.tier);
          const nonApproveBands = bands.filter((b) => b.outcome !== 'APPROVE');
          const rule = activeConfig.creditLimitRules[modelId];
          const segmentMax = rule?.segmentMaximumKwd ?? 0;
          const approveTierNames = approveBands.map((b) => b.tier as string);
          const validation = rule
            ? validateCreditLimitRule(rule, activeConfig.globalSettings.globalMaxBnplLimit, approveTierNames)
            : { valid: true, issues: [] };

          return (
            <Card key={modelId} title={activeConfig.scoringModels[modelId].name}>
              {!validation.valid && (
                <p className="small-note" style={{ marginBottom: 14, borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ {validation.issues.join('; ')}</p>
              )}
              <div className="field-group" style={{ maxWidth: 260 }}>
                <label className="field-label">Segment Maximum Credit Limit (KWD)</label>
                <input type="number" value={segmentMax} onChange={(e) => patchSegmentMax(modelId, Number(e.target.value))} />
                <p className="card-desc" style={{ marginTop: 4 }}>
                  Maximum credit limit that can be granted to a customer in this segment, regardless of the customer's
                  score or tier.
                </p>
              </div>

              <p className="card-title" style={{ marginTop: 14, marginBottom: 8, fontSize: 14 }}>Tier Credit Limits</p>
              <div className="stack-sm">
                {approveBands.map((b) => (
                  <div key={b.id} className="flex-row" style={{ alignItems: 'center', gap: 10 }}>
                    <span className="badge badge-approve" style={{ minWidth: 64, textAlign: 'center' }}>{b.tier}</span>
                    <span className="muted" title={`Score ${formatPercent(b.min * 100)} – ${formatPercent(Math.min(1, b.max) * 100)}`}>→</span>
                    <input
                      type="number" style={{ width: 100 }} value={rule?.tiers[b.tier as string] ?? 0}
                      onChange={(e) => patchTierLimit(modelId, b.tier as string, Number(e.target.value))}
                    />
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
              <p className="small-note" style={{ marginTop: 10 }}>
                Tier names and score thresholds are configured on the Decision Bands page — this page only configures
                the KWD amount for each tier.
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
