import { useMemo, useRef, useState } from 'react';
import { useConfigStore } from '../hooks/ConfigContext';
import { Card, Button, EmptyState, KpiTile } from '../components/ui';
import { findPreapprovedMatch } from '../engine/preapprovedEngine';
import { PREAPPROVED_MATCH_LABELS } from '../models/preapproved';
import { parseSpreadsheetFile, validateImportRows } from '../utils/preapprovedImport';
import type { ValidatedImportRow } from '../utils/preapprovedImport';
import { generateBatchId } from '../storage/preapprovedStorage';
import { formatDateTime } from '../utils/format';

const TABS = [
  { key: 'entries', label: 'Entries' },
  { key: 'import', label: 'Upload / Import' },
  { key: 'batches', label: 'Batch History' },
  { key: 'simulator', label: 'Matching Simulator' },
  { key: 'performance', label: 'Performance' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function PreapprovedMarketingPage() {
  const {
    activeConfig, updateActiveConfig, history,
    preapprovedEntries, preapprovedBatches,
    importPreapprovedBatch, addPreapprovedEntry, setPreapprovedEntryStatus, deletePreapprovedEntry,
  } = useConfigStore();

  const [tab, setTab] = useState<TabKey>('entries');
  const policy = activeConfig.preapprovedMarketing;

  // --- Entries tab state ---
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState('all');
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'not_matched'>('all');

  const matchedEntryIds = useMemo(() => {
    const ids = new Set<string>();
    history.forEach((d) => { if (d.preapprovedEntryId) ids.add(d.preapprovedEntryId); });
    return ids;
  }, [history]);

  const filteredEntries = useMemo(() => {
    return preapprovedEntries.filter((e) => {
      if (batchFilter !== 'all' && e.batchId !== batchFilter) return false;
      const hasBeenMatched = matchedEntryIds.has(e.id);
      if (matchFilter === 'matched' && !hasBeenMatched) return false;
      if (matchFilter === 'not_matched' && hasBeenMatched) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = [e.civilId, e.mobile, e.email, e.customerName].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [preapprovedEntries, batchFilter, matchFilter, matchedEntryIds, search]);

  // --- Manual add entry state ---
  const [manualForm, setManualForm] = useState({ civilId: '', mobile: '', email: '', customerName: '', notes: '' });
  const [manualBatchMode, setManualBatchMode] = useState<'existing' | 'new'>(preapprovedBatches.length > 0 ? 'existing' : 'new');
  const [manualBatchId, setManualBatchId] = useState(preapprovedBatches[0]?.id ?? '');
  const [manualNewBatchName, setManualNewBatchName] = useState('Manual Entries');

  const handleAddManualEntry = () => {
    if (!manualForm.civilId.trim() && !manualForm.mobile.trim()) {
      alert('At least a Civil ID or Mobile number is required.');
      return;
    }
    const batch = manualBatchMode === 'existing'
      ? preapprovedBatches.find((b) => b.id === manualBatchId)
      : { id: generateBatchId(manualNewBatchName), name: manualNewBatchName.trim() || 'Manual Entries' };
    if (!batch) {
      alert('Select a batch first.');
      return;
    }
    addPreapprovedEntry(
      { civilId: manualForm.civilId.trim() || undefined, mobile: manualForm.mobile.trim() || undefined, email: manualForm.email.trim() || undefined, customerName: manualForm.customerName.trim() || undefined, notes: manualForm.notes.trim() || undefined },
      { id: batch.id, name: batch.name }
    );
    setManualForm({ civilId: '', mobile: '', email: '', customerName: '', notes: '' });
  };

  // --- Import tab state ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [validatedRows, setValidatedRows] = useState<ValidatedImportRow[]>([]);
  const [importBatchName, setImportBatchName] = useState('');
  const [importBatchId, setImportBatchId] = useState('');
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'replace'>('skip');
  const [importSummary, setImportSummary] = useState<{ imported: number; skipped: number } | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportSummary(null);
    try {
      const rows = await parseSpreadsheetFile(file);
      setValidatedRows(validateImportRows(rows));
      const suggestedName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      setImportBatchName(suggestedName);
      setImportBatchId(generateBatchId(suggestedName));
    } catch (err) {
      alert(`Could not read file: ${(err as Error).message}`);
      setValidatedRows([]);
    }
    e.target.value = '';
  };

  const validRows = validatedRows.filter((r) => r.valid);
  const invalidRows = validatedRows.filter((r) => !r.valid);
  const duplicateRows = validatedRows.filter((r) => r.duplicateInFile);

  const handleConfirmImport = () => {
    if (validRows.length === 0) return;
    const result = importPreapprovedBatch(
      { id: importBatchId || generateBatchId(importBatchName), name: importBatchName || 'Untitled Batch', fileName: fileName ?? undefined },
      validRows.map((r) => r.row),
      duplicateStrategy
    );
    setImportSummary({ imported: result.imported, skipped: result.skipped });
    setValidatedRows([]);
    setFileName(null);
  };

  // --- Matching simulator state ---
  const [simCivilId, setSimCivilId] = useState('');
  const [simMobile, setSimMobile] = useState('');
  const [simResult, setSimResult] = useState<ReturnType<typeof findPreapprovedMatch> | null>(null);

  const runSimulation = () => {
    setSimResult(findPreapprovedMatch(simCivilId.trim() || null, simMobile.trim() || null, preapprovedEntries));
  };

  // --- Performance stats ---
  const stats = useMemo(() => {
    const matchedDecisions = history.filter((d) => d.preapprovedMatchStatus !== 'not_matched');
    const uniqueMatchedEntries = new Set(matchedDecisions.map((d) => d.preapprovedEntryId).filter(Boolean));
    const byBatch = new Map<string, { name: string; decisions: typeof matchedDecisions }>();
    matchedDecisions.forEach((d) => {
      const key = d.preapprovedBatchId ?? 'unknown';
      if (!byBatch.has(key)) byBatch.set(key, { name: d.preapprovedBatchName ?? key, decisions: [] });
      byBatch.get(key)!.decisions.push(d);
    });
    return {
      totalUploaded: preapprovedEntries.length,
      matchedCustomers: uniqueMatchedEntries.size,
      decisionsGenerated: matchedDecisions.length,
      approved: matchedDecisions.filter((d) => d.decisionOutcome === 'APPROVE').length,
      rejectedByHardGate: matchedDecisions.filter((d) => d.hardGateFailed).length,
      approvedNaturally: matchedDecisions.filter((d) => d.originalDecisionOutcome === 'APPROVE').length,
      approvedViaFloor: matchedDecisions.filter((d) => d.preapprovedOverrideApplied).length,
      byBatch: Array.from(byBatch.entries()).map(([batchId, v]) => ({
        batchId,
        name: v.name,
        registered: preapprovedEntries.filter((e) => e.batchId === batchId).length,
        matched: new Set(v.decisions.map((d) => d.preapprovedEntryId)).size,
        approvedNaturally: v.decisions.filter((d) => d.originalDecisionOutcome === 'APPROVE').length,
        approvedViaFloor: v.decisions.filter((d) => d.preapprovedOverrideApplied).length,
        hardGateRejected: v.decisions.filter((d) => d.hardGateFailed).length,
      })),
    };
  }, [history, preapprovedEntries]);

  return (
    <div>
      <div className="page-header">
        <div className="flex-between">
          <div>
            <h1 className="page-title">Preapproved Marketing List</h1>
            <p className="page-subtitle">Trolley / marketing customers uploaded to BRDG Pay before registration.</p>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) => updateActiveConfig((cfg) => ({ ...cfg, preapprovedMarketing: { ...cfg.preapprovedMarketing, enabled: e.target.checked } }))}
            />
            <strong>{policy.enabled ? 'Policy Enabled' : 'Policy Disabled'}</strong>
          </label>
        </div>
      </div>

      <Card>
        <p style={{ margin: 0 }}>
          Preapproved marketing customers still go through normal identity, eligibility, segmentation and scoring checks.
          If they pass eligibility but their normal decision is not Approved, BRDG Pay can promote the decision to the
          lowest configured approved tier. Credit limits continue to follow the normal segment and global limits.
        </p>
      </Card>

      <Card title="Preapproved Marketing Policy" desc="Matching priority and the decision effect are fixed for safety — only Enabled is adjustable.">
        <div className="locked-row"><span>Enabled</span><span className="locked-value">{policy.enabled ? 'Yes' : 'No'}</span></div>
        <div className="locked-row"><span>Matching Priority</span><span className="locked-value">1. Verified Civil ID · 2. Normalized Mobile</span></div>
        <div className="locked-row"><span>Decision Effect</span><span className="locked-value">Floor to Lowest Approved Tier</span></div>
        <div className="locked-row"><span>Bypass Hard Gates</span><span className="locked-value">No — locked</span></div>
        <div className="locked-row"><span>Bypass Segment</span><span className="locked-value">No — locked</span></div>
        <div className="locked-row"><span>Change Credit Limit Directly</span><span className="locked-value">No — locked</span></div>
      </Card>

      <div className="tabs">
        {TABS.map((t) => (
          <div key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</div>
        ))}
      </div>

      {tab === 'entries' && (
        <Card
          title={`Entries (${filteredEntries.length} of ${preapprovedEntries.length})`}
          actions={<Button size="sm" onClick={() => setTab('import')}>+ Upload File</Button>}
        >
          <div className="grid grid-3" style={{ marginBottom: 14 }}>
            <div className="field-group" style={{ marginBottom: 0 }}>
              <label className="field-label">Search</label>
              <input type="text" placeholder="Civil ID, mobile, email, name…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="field-group" style={{ marginBottom: 0 }}>
              <label className="field-label">Batch</label>
              <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
                <option value="all">All Batches</option>
                {preapprovedBatches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field-group" style={{ marginBottom: 0 }}>
              <label className="field-label">Match Status</label>
              <select value={matchFilter} onChange={(e) => setMatchFilter(e.target.value as typeof matchFilter)}>
                <option value="all">All</option>
                <option value="matched">Matched at least once</option>
                <option value="not_matched">Not yet matched</option>
              </select>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Civil ID</th><th>Mobile</th><th>Name</th><th>Email</th><th>Batch</th><th>Uploaded</th><th>Status</th><th>Matched?</th><th></th></tr>
              </thead>
              <tbody>
                {filteredEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{e.civilId ?? '—'}</td>
                    <td className="mono">{e.mobile ?? '—'}</td>
                    <td>{e.customerName ?? '—'}</td>
                    <td className="muted">{e.email ?? '—'}</td>
                    <td>{e.batchName ?? e.batchId}</td>
                    <td className="muted">{formatDateTime(e.uploadedAt)}</td>
                    <td>
                      <span className={`badge ${e.status === 'active' ? 'badge-approve' : 'badge-neutral'}`}>{e.status}</span>
                    </td>
                    <td>{matchedEntryIds.has(e.id) ? <span className="badge badge-review-status">Yes</span> : <span className="muted">No</span>}</td>
                    <td>
                      <div className="pill-btn-group">
                        <Button size="sm" onClick={() => setPreapprovedEntryStatus(e.id, e.status === 'active' ? 'inactive' : 'active')}>
                          {e.status === 'active' ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => { if (confirm('Remove this entry?')) deletePreapprovedEntry(e.id); }}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredEntries.length === 0 && (
                  <tr><td colSpan={9}><EmptyState>No entries match the current filters.</EmptyState></td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="divider" />
          <p className="card-desc" style={{ marginBottom: 10 }}>Add a single entry manually</p>
          <div className="grid grid-4">
            <div className="field-group"><label className="field-label">Civil ID</label><input type="text" value={manualForm.civilId} onChange={(e) => setManualForm((p) => ({ ...p, civilId: e.target.value }))} /></div>
            <div className="field-group"><label className="field-label">Mobile</label><input type="text" value={manualForm.mobile} onChange={(e) => setManualForm((p) => ({ ...p, mobile: e.target.value }))} /></div>
            <div className="field-group"><label className="field-label">Email</label><input type="text" value={manualForm.email} onChange={(e) => setManualForm((p) => ({ ...p, email: e.target.value }))} /></div>
            <div className="field-group"><label className="field-label">Customer Name</label><input type="text" value={manualForm.customerName} onChange={(e) => setManualForm((p) => ({ ...p, customerName: e.target.value }))} /></div>
          </div>
          <div className="grid grid-3">
            <div className="field-group">
              <label className="field-label">Batch</label>
              <select value={manualBatchMode} onChange={(e) => setManualBatchMode(e.target.value as 'existing' | 'new')}>
                <option value="existing">Add to existing batch</option>
                <option value="new">Create new batch</option>
              </select>
            </div>
            {manualBatchMode === 'existing' ? (
              <div className="field-group">
                <label className="field-label">Existing Batch</label>
                <select value={manualBatchId} onChange={(e) => setManualBatchId(e.target.value)}>
                  {preapprovedBatches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="field-group">
                <label className="field-label">New Batch Name</label>
                <input type="text" value={manualNewBatchName} onChange={(e) => setManualNewBatchName(e.target.value)} />
              </div>
            )}
            <div className="field-group">
              <label className="field-label">Notes</label>
              <input type="text" value={manualForm.notes} onChange={(e) => setManualForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <Button variant="primary" onClick={handleAddManualEntry}>+ Add Entry</Button>
        </Card>
      )}

      {tab === 'import' && (
        <Card title="Upload Excel / CSV" desc="Expected columns: civil_id, mobile, email, customer_name, notes">
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={handleFileSelect} />
          <Button onClick={() => fileInputRef.current?.click()}>Select File…</Button>
          {fileName && <span className="muted" style={{ marginLeft: 10 }}>{fileName}</span>}

          {importSummary && (
            <p className="small-note" style={{ marginTop: 14 }}>
              Import complete: {importSummary.imported} row(s) imported, {importSummary.skipped} skipped as duplicates.
            </p>
          )}

          {validatedRows.length > 0 && (
            <>
              <div className="divider" />
              <div className="grid grid-2">
                <div className="field-group"><label className="field-label">Batch Name</label><input type="text" value={importBatchName} onChange={(e) => { setImportBatchName(e.target.value); setImportBatchId(generateBatchId(e.target.value)); }} /></div>
                <div className="field-group"><label className="field-label">Batch ID</label><input type="text" className="mono" value={importBatchId} onChange={(e) => setImportBatchId(e.target.value)} /></div>
              </div>
              <div className="field-group" style={{ maxWidth: 320 }}>
                <label className="field-label">On Duplicate (matches existing Civil ID / Mobile)</label>
                <select value={duplicateStrategy} onChange={(e) => setDuplicateStrategy(e.target.value as 'skip' | 'replace')}>
                  <option value="skip">Skip Duplicate</option>
                  <option value="replace">Replace Existing</option>
                </select>
              </div>

              <p className="card-desc" style={{ margin: '10px 0' }}>
                Preview: {validRows.length} valid · {invalidRows.length} invalid · {duplicateRows.length} duplicate within file
              </p>
              <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead><tr><th>Civil ID</th><th>Mobile</th><th>Name</th><th>Email</th><th>Status</th></tr></thead>
                  <tbody>
                    {validatedRows.map((r, idx) => (
                      <tr key={idx} style={!r.valid ? { opacity: 0.5 } : undefined}>
                        <td className="mono">{r.row.civilId ?? '—'}</td>
                        <td className="mono">{r.row.mobile ?? '—'}</td>
                        <td>{r.row.customerName ?? '—'}</td>
                        <td className="muted">{r.row.email ?? '—'}</td>
                        <td>
                          {r.emptyRow ? <span className="badge badge-neutral">Empty</span>
                            : r.missingIdentifier ? <span className="badge badge-reject">Missing ID</span>
                            : r.duplicateInFile ? <span className="badge badge-review">Duplicate in File</span>
                            : <span className="badge badge-approve">Valid</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="primary" onClick={handleConfirmImport} disabled={validRows.length === 0} className="btn-block">
                Import {validRows.length} Record(s)
              </Button>
            </>
          )}
        </Card>
      )}

      {tab === 'batches' && (
        <Card title="Batch History">
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Batch ID</th><th>Name</th><th>File</th><th>Uploaded</th><th>Total Entries</th><th>Active Entries</th></tr></thead>
              <tbody>
                {preapprovedBatches.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.id}</td>
                    <td>{b.name}</td>
                    <td className="muted">{b.fileName ?? '—'}</td>
                    <td className="muted">{formatDateTime(b.uploadedAt)}</td>
                    <td>{b.totalEntries}</td>
                    <td>{b.activeEntries}</td>
                  </tr>
                ))}
                {preapprovedBatches.length === 0 && <tr><td colSpan={6}><EmptyState>No batches uploaded yet.</EmptyState></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'simulator' && (
        <Card title="Matching Simulator" desc="Test how a verified Civil ID or Mobile number would resolve against the current list — the exact function used by the decision engine.">
          <div className="grid grid-2">
            <div className="field-group"><label className="field-label">Verified Civil ID</label><input type="text" value={simCivilId} onChange={(e) => setSimCivilId(e.target.value)} placeholder="e.g. 555000000001" /></div>
            <div className="field-group"><label className="field-label">Mobile</label><input type="text" value={simMobile} onChange={(e) => setSimMobile(e.target.value)} placeholder="e.g. +96555000001" /></div>
          </div>
          <Button variant="primary" onClick={runSimulation}>Check Match</Button>

          {simResult && (
            <div className="card" style={{ marginTop: 16, boxShadow: 'none' }}>
              <div className="grid grid-2">
                <div>
                  <div className="kpi-label">Match Status</div>
                  <div className="kpi-value" style={{ fontSize: 18 }}>{PREAPPROVED_MATCH_LABELS[simResult.status]}</div>
                </div>
                <div>
                  <div className="kpi-label">Matched Field</div>
                  <div className="kpi-value" style={{ fontSize: 18 }}>{simResult.status === 'matched_civil_id' ? 'Civil ID' : simResult.status === 'matched_phone' ? 'Mobile' : '—'}</div>
                </div>
              </div>
              {simResult.entry && (
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="data-table">
                    <tbody>
                      <tr><td>Matched Entry</td><td>{simResult.entry.customerName ?? simResult.entry.id}</td></tr>
                      <tr><td>Batch</td><td>{simResult.entry.batchName} ({simResult.entry.batchId})</td></tr>
                      <tr><td>Civil ID</td><td className="mono">{simResult.entry.civilId ?? '—'}</td></tr>
                      <tr><td>Mobile</td><td className="mono">{simResult.entry.mobile ?? '—'}</td></tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {tab === 'performance' && (
        <div>
          <div className="grid grid-4">
            <KpiTile label="Total Uploaded" value={String(stats.totalUploaded)} />
            <KpiTile label="Matched Customers" value={String(stats.matchedCustomers)} />
            <KpiTile label="Decisions Generated" value={String(stats.decisionsGenerated)} />
            <KpiTile label="Approved" value={String(stats.approved)} />
          </div>
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <KpiTile label="Rejected by Hard Gate" value={String(stats.rejectedByHardGate)} />
            <KpiTile label="Already Approved Naturally" value={String(stats.approvedNaturally)} />
            <KpiTile label="Approved Due to Preapproval Floor" value={String(stats.approvedViaFloor)} />
          </div>

          <div style={{ marginTop: 16 }}>
            <Card title="By Batch">
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Batch</th><th>Uploaded</th><th>Registered / Matched</th><th>Approved Naturally</th><th>Approved Through Floor</th><th>Hard Gate Rejected</th></tr></thead>
                  <tbody>
                    {stats.byBatch.map((b) => (
                      <tr key={b.batchId}>
                        <td>{b.name}</td>
                        <td>{b.registered}</td>
                        <td>{b.matched}</td>
                        <td>{b.approvedNaturally}</td>
                        <td>{b.approvedViaFloor}</td>
                        <td>{b.hardGateRejected}</td>
                      </tr>
                    ))}
                    {stats.byBatch.length === 0 && <tr><td colSpan={6}><EmptyState>No decisions have matched a preapproved entry yet.</EmptyState></td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
