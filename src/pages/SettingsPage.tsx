import { useConfigStore } from '../hooks/ConfigContext';
import { Card, Button } from '../components/ui';
import type { AiConfidence, AiProvider } from '../models/aiAdvisor';

export default function SettingsPage() {
  const { activeConfig, updateActiveConfig, resetDemo } = useConfigStore();
  const ai = activeConfig.aiAdvisor;

  const patchAi = (patch: Partial<typeof ai>) => {
    updateActiveConfig((cfg) => ({ ...cfg, aiAdvisor: { ...cfg.aiAdvisor, ...patch } }));
  };

  const handleReset = () => {
    if (confirm('Reset all configuration and decision history back to the seeded demo defaults? This cannot be undone.')) {
      resetDemo();
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Global engine behavior and demo data controls.</p>
      </div>

      <Card title="Manual Review Threshold" desc="If more than this share of a scoring model's total weight is unavailable at decision time, the outcome is forced to Manual Review with reason code INSUFFICIENT_VERIFIED_DATA.">
        <div className="field-group" style={{ maxWidth: 220 }}>
          <label className="field-label">Threshold (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            value={activeConfig.globalSettings.manualReviewMissingWeightThreshold}
            onChange={(e) => updateActiveConfig((cfg) => ({ ...cfg, globalSettings: { ...cfg.globalSettings, manualReviewMissingWeightThreshold: Number(e.target.value) } }))}
          />
        </div>
      </Card>

      <Card title="Debt-to-Income Source" desc="How the BRDG-aggregated Monthly Debt Obligations figure is sourced for demo purposes. Debt-to-Income itself is always derived (obligations ÷ income) — this only controls where the obligations figure comes from.">
        <div className="field-group" style={{ maxWidth: 360 }}>
          <select
            value={activeConfig.globalSettings.dtiSourceMode}
            onChange={(e) => updateActiveConfig((cfg) => ({ ...cfg, globalSettings: { ...cfg.globalSettings, dtiSourceMode: e.target.value as 'separate_obligation' | 'bnpl_payment' } }))}
          >
            <option value="separate_obligation">Separate mock obligation value (default)</option>
            <option value="bnpl_payment">Mirror CINET Total Monthly BNPL Payment</option>
          </select>
        </div>
        <p className="small-note">BNPL payment alone is never assumed to represent all of a customer's debt — this is an explicit demo choice, not a CINET-defined behavior.</p>
      </Card>

      <Card
        title="AI Manual Review Advisor"
        desc="Advisory-only layer, invoked only for Manual Review decisions. It never approves, rejects, or sets a final credit limit — every recommendation requires explicit reviewer confirmation on the Decision Result page."
      >
        <label className="checkbox-row" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={ai.enabled} onChange={(e) => patchAi({ enabled: e.target.checked })} />
          Enable AI Manual Review Advisor
        </label>

        <div className="grid grid-3">
          <div className="field-group">
            <label className="field-label">Provider</label>
            <select value={ai.provider} onChange={(e) => patchAi({ provider: e.target.value as AiProvider })}>
              <option value="simulated">Simulated (no API key required)</option>
              <option value="anthropic">Anthropic (real API — requires a key)</option>
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Model</label>
            <input type="text" value={ai.model} onChange={(e) => patchAi({ model: e.target.value })} />
          </div>
          <div className="field-group">
            <label className="field-label">AI Recommendation Mode</label>
            <select value={ai.recommendationMode} disabled>
              <option value="ADVISORY_ONLY">Advisory Only</option>
            </select>
          </div>
        </div>

        <div className="grid grid-4">
          <div className="field-group">
            <label className="field-label">Temperature</label>
            <input type="number" step="0.1" min={0} max={1} value={ai.temperature} onChange={(e) => patchAi({ temperature: Number(e.target.value) })} />
          </div>
          <div className="field-group">
            <label className="field-label">Maximum Response Tokens</label>
            <input type="number" value={ai.maxResponseTokens} onChange={(e) => patchAi({ maxResponseTokens: Number(e.target.value) })} />
          </div>
          <div className="field-group">
            <label className="field-label">AI Timeout (ms)</label>
            <input type="number" value={ai.timeoutMs} onChange={(e) => patchAi({ timeoutMs: Number(e.target.value) })} />
          </div>
          <div className="field-group">
            <label className="field-label">Minimum Confidence Threshold</label>
            <select value={ai.minConfidenceThreshold} onChange={(e) => patchAi({ minConfidenceThreshold: e.target.value as AiConfidence })}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
        </div>

        {ai.provider === 'anthropic' && (
          <div className="field-group" style={{ maxWidth: 420 }}>
            <label className="field-label">Anthropic API Key</label>
            <input type="password" value={ai.apiKey ?? ''} onChange={(e) => patchAi({ apiKey: e.target.value || undefined })} placeholder="sk-ant-..." />
            <p className="small-note" style={{ marginTop: 6 }}>
              ⚠ This is a frontend-only demo with no backend — the key is stored in this browser's LocalStorage and sent
              directly from the browser to Anthropic's API. Acceptable for local experimentation only; never use a real
              production key here.
            </p>
          </div>
        )}

        <p className="small-note" style={{ marginTop: 10 }}>
          The Simulated provider is a deterministic stand-in that follows the same guardrails as a real model (no
          invented data, never overrides a failed Hard Gate, never exceeds configured credit policy) — it requires no
          API key and is the default so the whole Manual Review Advisor flow works out of the box.
        </p>
      </Card>

      <Card title="Demo Data" desc="This entire application runs on mock data and browser LocalStorage — there is no backend, database, or real credit bureau connection.">
        <Button variant="danger" onClick={handleReset}>Reset Demo Configuration &amp; History</Button>
      </Card>

      <Card title="About">
        <p className="muted">BRDG Pay – Scoring &amp; Decisioning Playground is a frontend-only functional prototype for exploring configurable BNPL segmentation, hard gates, scoring, and credit-limit logic. All values (including the "Configured Regulatory Cap") are illustrative demo settings, not verified real-world regulatory figures.</p>
      </Card>
    </div>
  );
}
