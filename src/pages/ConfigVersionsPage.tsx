import { useRef, useState } from 'react';
import { useConfigStore } from '../hooks/ConfigContext';
import { Card, Button, ConfigStatusBadge } from '../components/ui';
import { exportConfigurationJson } from '../storage/localStorageService';
import { formatDateTime } from '../utils/format';
import type { Configuration } from '../models/configuration';

const SECTIONS: { key: keyof Configuration; label: string }[] = [
  { key: 'segments', label: 'Segments' },
  { key: 'routingRules', label: 'Routing Rules' },
  { key: 'hardGates', label: 'Hard Gates' },
  { key: 'customerFields', label: 'Customer Fields' },
  { key: 'scoringModels', label: 'Scoring Models' },
  { key: 'decisionBands', label: 'Decision Bands' },
  { key: 'creditLimitRules', label: 'Credit Limit Rules' },
  { key: 'globalSettings', label: 'Global Settings' },
  { key: 'integrations', label: 'Integrations' },
];

export default function ConfigVersionsPage() {
  const { configs, createDraft, cloneConfig, activateConfig, retireConfig, deleteConfig, importConfig } = useConfigStore();
  const [compareIds, setCompareIds] = useState<[string, string]>(['', '']);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = (config: Configuration) => {
    const json = exportConfigurationJson(config);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brdgpay-config-${config.versionLabel}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importConfig(String(reader.result));
      } catch (err) {
        alert(`Import failed: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const configA = configs.find((c) => c.id === compareIds[0]);
  const configB = configs.find((c) => c.id === compareIds[1]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Configuration Versions</h1>
        <p className="page-subtitle">Draft, clone, compare, and activate scoring configurations — all persisted locally.</p>
      </div>

      <Card actions={
        <div className="flex-row">
          <Button size="sm" onClick={createDraft}>+ Create Draft</Button>
          <input ref={fileInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={handleImportFile} />
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>Import JSON</Button>
        </div>
      }>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Version</th><th>Status</th><th>Notes</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.versionLabel}</strong></td>
                  <td><ConfigStatusBadge status={c.status} /></td>
                  <td className="muted">{c.notes}</td>
                  <td className="muted">{formatDateTime(c.updatedAt)}</td>
                  <td>
                    <div className="pill-btn-group">
                      {c.status !== 'ACTIVE' && <Button size="sm" onClick={() => activateConfig(c.id)}>Activate</Button>}
                      {c.status === 'ACTIVE' && <Button size="sm" onClick={() => retireConfig(c.id)}>Retire</Button>}
                      <Button size="sm" onClick={() => cloneConfig(c.id)}>Clone</Button>
                      <Button size="sm" onClick={() => handleExport(c)}>Export</Button>
                      {c.status !== 'ACTIVE' && <Button size="sm" variant="danger" onClick={() => deleteConfig(c.id)}>Delete</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Compare Versions">
        <div className="grid grid-2">
          <div className="field-group">
            <label className="field-label">Version A</label>
            <select value={compareIds[0]} onChange={(e) => setCompareIds([e.target.value, compareIds[1]])}>
              <option value="">Select…</option>
              {configs.map((c) => <option key={c.id} value={c.id}>{c.versionLabel} ({c.status})</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Version B</label>
            <select value={compareIds[1]} onChange={(e) => setCompareIds([compareIds[0], e.target.value])}>
              <option value="">Select…</option>
              {configs.map((c) => <option key={c.id} value={c.id}>{c.versionLabel} ({c.status})</option>)}
            </select>
          </div>
        </div>

        {configA && configB && (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data-table">
              <thead><tr><th>Section</th><th>{configA.versionLabel}</th><th>{configB.versionLabel}</th><th>Diff</th></tr></thead>
              <tbody>
                {SECTIONS.map((s) => {
                  const same = JSON.stringify(configA[s.key]) === JSON.stringify(configB[s.key]);
                  return (
                    <tr key={String(s.key)}>
                      <td>{s.label}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{JSON.stringify(configA[s.key]).length} chars</td>
                      <td className="mono" style={{ fontSize: 11 }}>{JSON.stringify(configB[s.key]).length} chars</td>
                      <td>{same ? <span className="badge badge-neutral">Identical</span> : <span className="badge badge-review">Different</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
