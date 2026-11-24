import { useState } from 'react';
import { useConfigStore } from '../hooks/ConfigContext';
import { Card, Button } from '../components/ui';
import { formatKwd } from '../utils/format';
import {
  computeSegmentConfigStatus,
  createSegment,
  deleteSegment,
  findSegmentDeleteBlockers,
  validateSegmentRouting,
  SEGMENT_STATUS_BADGE_CLASS,
  type NewSegmentInput,
  type SegmentTemplate,
} from '../engine/segmentEngine';
import type { Segment } from '../models/configuration';

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'segment';
}

interface WizardForm {
  name: string;
  code: string;
  codeTouched: boolean;
  description: string;
  product: string;
  active: boolean;
  priority: number;
  creditAllowed: boolean;
  ageMin: string;
  ageMax: string;
  template: 'default' | 'empty' | 'clone';
  cloneFromSegmentId: string;
  segmentMaximumKwd: string;
}

function blankWizardForm(nextPriority: number): WizardForm {
  return {
    name: '', code: '', codeTouched: false, description: '', product: '', active: true, priority: nextPriority,
    creditAllowed: true, ageMin: '', ageMax: '', template: 'default', cloneFromSegmentId: '', segmentMaximumKwd: '0',
  };
}

export default function SegmentsPage() {
  const { activeConfig, updateActiveConfig, history } = useConfigStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [form, setForm] = useState<WizardForm>(() => blankWizardForm(10));

  const segments = [...activeConfig.segments].sort((a, b) => a.priority - b.priority);
  const routingValidation = validateSegmentRouting(activeConfig.segments);

  const patchSegment = (id: string, patch: Partial<Segment>) => {
    updateActiveConfig((cfg) => ({
      ...cfg,
      segments: cfg.segments.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s)),
    }));
  };

  const patchSegmentMax = (id: string, value: number) => {
    const seg = activeConfig.segments.find((s) => s.id === id);
    if (!seg?.scoringModelId) return;
    const modelId = seg.scoringModelId;
    updateActiveConfig((cfg) => ({
      ...cfg,
      creditLimitRules: { ...cfg.creditLimitRules, [modelId]: { ...cfg.creditLimitRules[modelId], segmentMaximumKwd: value } },
    }));
  };

  const openAddWizard = () => {
    const nextPriority = (Math.max(0, ...activeConfig.segments.map((s) => s.priority)) || 0) + 10;
    setForm(blankWizardForm(nextPriority));
    setWizardStep(0);
    setWizardOpen(true);
  };

  const openCloneWizard = (source: Segment) => {
    const nextPriority = (Math.max(0, ...activeConfig.segments.map((s) => s.priority)) || 0) + 10;
    const sourceMax = source.scoringModelId ? activeConfig.creditLimitRules[source.scoringModelId]?.segmentMaximumKwd ?? 0 : 0;
    setForm({
      name: `${source.name} (Copy)`, code: `${source.code}_copy`, codeTouched: true, description: source.description ?? '',
      product: source.product, active: true, priority: nextPriority, creditAllowed: source.creditAllowed,
      ageMin: String(source.ageMin ?? ''), ageMax: String(source.ageMax ?? ''),
      template: 'clone', cloneFromSegmentId: source.id, segmentMaximumKwd: String(sourceMax),
    });
    setWizardStep(0);
    setWizardOpen(true);
  };

  const closeWizard = () => setWizardOpen(false);

  // Live preview of routing validity for the segment about to be created, without saving.
  const previewSegments: Segment[] = [
    ...activeConfig.segments,
    {
      id: '__preview__', code: form.code || 'preview', name: form.name || 'New Segment', description: form.description,
      product: form.product, active: form.active, priority: Number(form.priority) || 999, routingMode: 'AGE_RANGE',
      ageMin: form.ageMin === '' ? undefined : Number(form.ageMin), ageMax: form.ageMax === '' ? undefined : Number(form.ageMax),
      creditAllowed: form.creditAllowed, scoringModelId: null, createdAt: '', updatedAt: '',
    },
  ];
  const previewValidation = validateSegmentRouting(previewSegments);
  const previewIssuesForNew = previewValidation.issues.filter((msg) => msg.includes(form.name || 'New Segment'));

  const submitWizard = () => {
    if (previewIssuesForNew.length > 0) {
      if (!window.confirm(`This segment's age range has routing issues:\n\n${previewIssuesForNew.join('\n')}\n\nCreate it anyway? You can fix the age range afterward.`)) return;
    }
    const input: NewSegmentInput = {
      name: form.name.trim() || 'New Segment',
      code: form.code.trim() || slugify(form.name),
      description: form.description.trim() || undefined,
      product: form.product.trim() || 'New Product',
      active: form.active,
      priority: Number(form.priority) || 999,
      creditAllowed: form.creditAllowed,
      ageMin: form.ageMin === '' ? undefined : Number(form.ageMin),
      ageMax: form.ageMax === '' ? undefined : Number(form.ageMax),
      segmentMaximumKwd: Number(form.segmentMaximumKwd) || 0,
      template: (form.template === 'clone' ? { cloneFromSegmentId: form.cloneFromSegmentId } : form.template) as SegmentTemplate,
    };
    updateActiveConfig((cfg) => createSegment(cfg, input));
    setWizardOpen(false);
  };

  const toggleActive = (seg: Segment) => {
    patchSegment(seg.id, { active: !seg.active });
  };

  const handleDelete = (seg: Segment) => {
    const blockers = findSegmentDeleteBlockers(seg.id, history);
    if (blockers.length > 0) {
      window.alert(blockers.join('\n'));
      return;
    }
    if (!window.confirm(`Permanently delete "${seg.name}"? This also removes its Scoring Model, Decision Bands, and Credit Limit Rules (if no other segment uses them). This cannot be undone.`)) return;
    updateActiveConfig((cfg) => deleteSegment(cfg, seg.id));
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Segments</h1>
        <p className="page-subtitle">
          The fully configurable list of customer segments. Each segment's age-range routing is configured right here —
          the Decision Engine page then loads that segment's Eligibility Rules, Scoring Model, Decision Bands, and
          Credit Limits, all automatically, with no code change required.
        </p>
      </div>

      {!routingValidation.valid && (
        <Card>
          <p className="small-note" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ {routingValidation.issues.join(' ')}</p>
        </Card>
      )}

      <Card actions={<Button variant="primary" onClick={openAddWizard}>+ Add Segment</Button>}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Segment</th><th>Age Range</th><th>Product</th><th>Status</th><th>Priority</th>
                <th>Credit Allowed</th><th>Segment Maximum</th><th>Config Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg) => {
                const segMax = seg.scoringModelId ? activeConfig.creditLimitRules[seg.scoringModelId]?.segmentMaximumKwd ?? 0 : null;
                const configStatus = computeSegmentConfigStatus(activeConfig, seg.id);
                const ageLabel = seg.ageMax !== undefined ? `${seg.ageMin ?? 0}–${seg.ageMax}` : `${seg.ageMin ?? 0}+`;
                return (
                  <tr key={seg.id}>
                    <td><strong>{seg.name}</strong><div className="muted mono" style={{ fontSize: 11 }}>{seg.code}</div></td>
                    <td>{ageLabel}</td>
                    <td>{seg.product}</td>
                    <td><span className={`badge ${seg.active ? 'badge-approve' : 'badge-neutral'}`}>{seg.active ? 'Active' : 'Inactive'}</span></td>
                    <td>{seg.priority}</td>
                    <td>{seg.creditAllowed ? 'Yes' : 'No'}</td>
                    <td>{segMax !== null ? formatKwd(segMax) : '—'}</td>
                    <td title={configStatus.issues.join(' ')}><span className={`badge ${SEGMENT_STATUS_BADGE_CLASS[configStatus.status]}`}>{configStatus.status}</span></td>
                    <td>
                      <div className="flex-row">
                        <Button size="sm" onClick={() => setEditingId(editingId === seg.id ? null : seg.id)}>{editingId === seg.id ? 'Close' : 'Edit'}</Button>
                        <Button size="sm" onClick={() => openCloneWizard(seg)}>Clone</Button>
                        <Button size="sm" onClick={() => toggleActive(seg)}>{seg.active ? 'Deactivate' : 'Activate'}</Button>
                        <Button size="sm" variant="danger" onClick={() => handleDelete(seg)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {editingId && (() => {
          const seg = activeConfig.segments.find((s) => s.id === editingId);
          if (!seg) return null;
          const segMax = seg.scoringModelId ? activeConfig.creditLimitRules[seg.scoringModelId]?.segmentMaximumKwd ?? 0 : 0;
          return (
            <div className="card" style={{ marginTop: 14 }}>
              <p className="card-title" style={{ marginBottom: 10 }}>Editing: {seg.name} <span className="muted mono" style={{ fontSize: 12 }}>({seg.id})</span></p>
              <div className="grid grid-3">
                <div className="field-group">
                  <label className="field-label">Display Name</label>
                  <input type="text" value={seg.name} onChange={(e) => patchSegment(seg.id, { name: e.target.value })} />
                  <p className="card-desc" style={{ marginTop: 4 }}>Renaming never affects this segment's configuration — it's always attached to the Segment ID above.</p>
                </div>
                <div className="field-group">
                  <label className="field-label">Segment Code</label>
                  <input type="text" className="mono" value={seg.code} onChange={(e) => patchSegment(seg.id, { code: e.target.value })} />
                </div>
                <div className="field-group">
                  <label className="field-label">Product Name</label>
                  <input type="text" value={seg.product} onChange={(e) => patchSegment(seg.id, { product: e.target.value })} />
                </div>
              </div>
              <div className="field-group">
                <label className="field-label">Description</label>
                <input type="text" value={seg.description ?? ''} onChange={(e) => patchSegment(seg.id, { description: e.target.value })} />
              </div>
              <div className="grid grid-4">
                <div className="field-group">
                  <label className="field-label">Minimum Age</label>
                  <input type="number" value={seg.ageMin ?? ''} onChange={(e) => patchSegment(seg.id, { ageMin: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
                <div className="field-group">
                  <label className="field-label">Maximum Age</label>
                  <input type="number" value={seg.ageMax ?? ''} placeholder="open-ended" onChange={(e) => patchSegment(seg.id, { ageMax: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
                <div className="field-group">
                  <label className="field-label">Priority</label>
                  <input type="number" value={seg.priority} onChange={(e) => patchSegment(seg.id, { priority: Number(e.target.value) })} />
                </div>
                <div className="field-group">
                  <label className="field-label">Routing Mode</label>
                  <select value={seg.routingMode} disabled>
                    <option value="AGE_RANGE">Age Range</option>
                    <option value="ADVANCED">Advanced (Coming Soon)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-3">
                <label className="checkbox-row"><input type="checkbox" checked={seg.active} onChange={(e) => patchSegment(seg.id, { active: e.target.checked })} /> Active</label>
                <label className="checkbox-row"><input type="checkbox" checked={seg.creditAllowed} onChange={(e) => patchSegment(seg.id, { creditAllowed: e.target.checked })} /> Credit Allowed</label>
                {seg.scoringModelId && (
                  <div className="field-group">
                    <label className="field-label">Segment Maximum Credit Limit (KWD)</label>
                    <input type="number" value={segMax} onChange={(e) => patchSegmentMax(seg.id, Number(e.target.value))} />
                  </div>
                )}
              </div>
              <p className="small-note" style={{ marginTop: 10 }}>
                Eligibility Rules, Scoring Model, Decision Bands, and Tier Credit Limits are configured on the{' '}
                <strong>Decision Engine</strong> page, under this segment's own tab.
              </p>
            </div>
          );
        })()}
      </Card>

      {wizardOpen && (
        <Card title="Add Segment">
          <div className="wizard-steps">
            {['1. Basic Information', '2. Routing', '3. Decision Engine Initialization'].map((label, idx) => (
              <div key={label} className={`wizard-step${idx === wizardStep ? ' active' : idx < wizardStep ? ' done' : ''}`} onClick={() => setWizardStep(idx)} style={{ cursor: 'pointer' }}>{label}</div>
            ))}
          </div>

          {wizardStep === 0 && (
            <div className="grid grid-2">
              <div className="field-group">
                <label className="field-label">Segment Name</label>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, code: f.codeTouched ? f.code : slugify(e.target.value) }))} />
              </div>
              <div className="field-group">
                <label className="field-label">Segment Code</label>
                <input type="text" className="mono" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value, codeTouched: true }))} />
              </div>
              <div className="field-group" style={{ gridColumn: '1 / -1' }}>
                <label className="field-label">Description</label>
                <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="field-group">
                <label className="field-label">Product Name</label>
                <input type="text" value={form.product} onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))} />
              </div>
              <div className="field-group">
                <label className="field-label">Priority</label>
                <input type="number" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))} />
              </div>
              <label className="checkbox-row"><input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} /> Active</label>
              <label className="checkbox-row"><input type="checkbox" checked={form.creditAllowed} onChange={(e) => setForm((f) => ({ ...f, creditAllowed: e.target.checked }))} /> Credit Allowed</label>
            </div>
          )}

          {wizardStep === 1 && (
            <div>
              <div className="grid grid-3">
                <div className="field-group">
                  <label className="field-label">Routing Mode</label>
                  <select value="AGE_RANGE" disabled>
                    <option value="AGE_RANGE">Age Range</option>
                    <option value="ADVANCED">Advanced (Coming Soon)</option>
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">Minimum Age</label>
                  <input type="number" value={form.ageMin} onChange={(e) => setForm((f) => ({ ...f, ageMin: e.target.value }))} />
                </div>
                <div className="field-group">
                  <label className="field-label">Maximum Age</label>
                  <input type="number" value={form.ageMax} placeholder="open-ended" onChange={(e) => setForm((f) => ({ ...f, ageMax: e.target.value }))} />
                </div>
              </div>
              {previewIssuesForNew.length > 0 && (
                <p className="small-note" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ {previewIssuesForNew.join(' ')}</p>
              )}
            </div>
          )}

          {wizardStep === 2 && (
            <div>
              <div className="field-group">
                <label className="field-label">Create Decision Engine Configuration From</label>
                <div className="stack-sm">
                  <label className="checkbox-row"><input type="radio" name="template" checked={form.template === 'default'} onChange={() => setForm((f) => ({ ...f, template: 'default' }))} /> Default Template — standard Decision Bands, empty Scoring Model and Eligibility Rules</label>
                  <label className="checkbox-row"><input type="radio" name="template" checked={form.template === 'empty'} onChange={() => setForm((f) => ({ ...f, template: 'empty' }))} /> Empty Configuration — nothing pre-filled</label>
                  <label className="checkbox-row"><input type="radio" name="template" checked={form.template === 'clone'} onChange={() => setForm((f) => ({ ...f, template: 'clone' }))} /> Clone Existing Segment</label>
                </div>
              </div>
              {form.template === 'clone' && (
                <div className="field-group" style={{ maxWidth: 320 }}>
                  <label className="field-label">Clone From</label>
                  <select
                    value={form.cloneFromSegmentId}
                    onChange={(e) => {
                      const src = activeConfig.segments.find((s) => s.id === e.target.value);
                      const srcMax = src?.scoringModelId ? activeConfig.creditLimitRules[src.scoringModelId]?.segmentMaximumKwd ?? 0 : 0;
                      setForm((f) => ({ ...f, cloneFromSegmentId: e.target.value, segmentMaximumKwd: String(srcMax) }));
                    }}
                  >
                    <option value="">— Select —</option>
                    {activeConfig.segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div className="field-group" style={{ maxWidth: 260, marginTop: 10 }}>
                <label className="field-label">Segment Maximum Credit Limit (KWD)</label>
                <input type="number" value={form.segmentMaximumKwd} onChange={(e) => setForm((f) => ({ ...f, segmentMaximumKwd: e.target.value }))} />
                <p className="card-desc" style={{ marginTop: 4 }}>Must not exceed the Global Maximum BNPL Limit ({formatKwd(activeConfig.globalSettings.globalMaxBnplLimit)}).</p>
              </div>
            </div>
          )}

          <div className="wizard-actions">
            <Button onClick={closeWizard}>Cancel</Button>
            <div className="flex-row">
              <Button onClick={() => setWizardStep((s) => Math.max(0, s - 1))} disabled={wizardStep === 0}>← Back</Button>
              {wizardStep < 2 ? (
                <Button variant="primary" onClick={() => setWizardStep((s) => Math.min(2, s + 1))}>Next →</Button>
              ) : (
                <Button variant="primary" onClick={submitWizard}>Create Segment</Button>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
