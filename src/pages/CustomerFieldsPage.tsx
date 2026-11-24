import { useState } from 'react';
import { useConfigStore } from '../hooks/ConfigContext';
import { Card } from '../components/ui';
import type { CustomerDataField, FieldGroup } from '../models/configuration';

const GROUPS: { key: FieldGroup; label: string }[] = [
  { key: 'identity', label: 'Identity' },
  { key: 'employment', label: 'Employment & Financial' },
  { key: 'cinet', label: 'CINET' },
  { key: 'other', label: 'Other' },
];

export default function CustomerFieldsPage() {
  const { activeConfig, updateActiveConfig } = useConfigStore();
  const [group, setGroup] = useState<FieldGroup | 'all'>('all');

  const patch = (key: string, p: Partial<CustomerDataField>) => {
    updateActiveConfig((cfg) => ({ ...cfg, customerFields: cfg.customerFields.map((f) => (f.key === key ? { ...f, ...p } : f)) }));
  };

  const fields = activeConfig.customerFields.filter((f) => group === 'all' || f.group === group);

  const usageLabelFor = (f: CustomerDataField): string => {
    if (f.usageLabel) return f.usageLabel;
    const roles: string[] = [];
    if (f.useForRouting) roles.push('Routing');
    if (f.useAsHardGate) roles.push('Hard Gate');
    if (f.useForScoring) roles.push('Scoring');
    return roles.length > 0 ? roles.join(' / ') : 'Profile';
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Customer Data Fields</h1>
        <p className="page-subtitle">The configurable catalog of every field the engine can see. Gender and nationality are permanently barred from automated scoring.</p>
      </div>

      <div className="tabs">
        <div className={`tab${group === 'all' ? ' active' : ''}`} onClick={() => setGroup('all')}>All</div>
        {GROUPS.map((g) => (
          <div key={g.key} className={`tab${group === g.key ? ' active' : ''}`} onClick={() => setGroup(g.key)}>{g.label}</div>
        ))}
      </div>

      <Card>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Field</th><th>Usage</th><th>Type</th><th>Source</th><th>Enabled</th><th>Visible</th><th>Routing</th><th>Hard Gate</th><th>Scoring</th><th>Required</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.key}>
                  <td style={{ minWidth: 220 }}>
                    <div><strong>{f.displayName}</strong></div>
                    <div className="muted mono" style={{ fontSize: 11 }}>{f.key}</div>
                    {f.restrictionNote && (
                      <div className="small-note" style={{ marginTop: 6, maxWidth: 320 }}>{f.restrictionNote}</div>
                    )}
                  </td>
                  <td><span className="badge badge-neutral">{usageLabelFor(f)}</span></td>
                  <td className="mono">{f.type}</td>
                  <td>{f.source}</td>
                  <td><input type="checkbox" checked={f.enabled} onChange={(e) => patch(f.key, { enabled: e.target.checked })} /></td>
                  <td><input type="checkbox" checked={f.visibleInPlayground} onChange={(e) => patch(f.key, { visibleInPlayground: e.target.checked })} /></td>
                  <td>
                    <input
                      type="checkbox"
                      checked={f.useForRouting && !f.restrictedFromScoring}
                      disabled={f.restrictedFromScoring}
                      title={f.restrictedFromScoring ? f.restrictionNote : undefined}
                      onChange={(e) => patch(f.key, { useForRouting: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={f.useAsHardGate}
                      title="restrictedFromScoring only bars a field from weighted scoring — it remains eligible as a categorical hard-gate condition (e.g. Nationality)."
                      onChange={(e) => patch(f.key, { useAsHardGate: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={f.useForScoring && !f.restrictedFromScoring}
                      disabled={f.restrictedFromScoring}
                      title={f.restrictedFromScoring ? f.restrictionNote : 'Eligible as a scoring factor'}
                      onChange={(e) => patch(f.key, { useForScoring: e.target.checked })}
                    />
                  </td>
                  <td><input type="checkbox" checked={f.required} onChange={(e) => patch(f.key, { required: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
