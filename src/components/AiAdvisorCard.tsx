import { useState } from 'react';
import { Card, Button } from './ui';
import { formatKwd } from '../utils/format';
import { runAiAdvisor, shouldInvokeAiAdvisor } from '../engine/aiAdvisorEngine';
import { saveAiAuditRecord, recordReviewerAction } from '../storage/aiAdvisorStorage';
import type { Configuration } from '../models/configuration';
import type { DecisionResult } from '../models/decision';
import type { AiAdvisorAuditRecord, ReviewerAction } from '../models/aiAdvisor';

const CONFIDENCE_LABEL: Record<string, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };
const ACTION_LABEL: Record<string, string> = { APPROVE: 'APPROVE', REJECT: 'REJECT', REQUEST_MORE_INFORMATION: 'REQUEST MORE INFORMATION' };

function actionBadgeClass(action: string): string {
  if (action === 'APPROVE') return 'badge-approve';
  if (action === 'REJECT') return 'badge-reject';
  return 'badge-review';
}

export function AiAdvisorCard({
  decision,
  config,
  audit,
  onAuditChange,
}: {
  decision: DecisionResult;
  config: Configuration;
  audit: AiAdvisorAuditRecord | undefined;
  onAuditChange: (next: AiAdvisorAuditRecord) => void;
}) {
  const [running, setRunning] = useState(false);
  const [reviewerName, setReviewerName] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideDecision, setOverrideDecision] = useState<'APPROVE' | 'REJECT' | 'MANUAL_REVIEW'>('REJECT');
  const [overrideTier, setOverrideTier] = useState('');
  const [overrideLimit, setOverrideLimit] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  if (!shouldInvokeAiAdvisor(decision)) return null;

  const runReview = async () => {
    setRunning(true);
    const result = await runAiAdvisor(decision, config);
    saveAiAuditRecord(result);
    onAuditChange(result);
    setRunning(false);
  };

  const applyReviewerAction = (
    action: ReviewerAction,
    finalDecision: { decision: 'APPROVE' | 'REJECT' | 'MANUAL_REVIEW'; tier: string | null; limitKwd: number | null },
    reason?: string
  ) => {
    if (!audit) return;
    const updated = recordReviewerAction(audit.id, {
      reviewerUserName: reviewerName || 'Demo Reviewer',
      reviewerAction: action,
      reviewerFinalDecision: finalDecision,
      reviewerOverrideReason: reason,
    });
    if (updated) onAuditChange(updated);
    setOverrideOpen(false);
  };

  const acceptRecommendation = () => {
    if (!audit?.recommendation) return;
    const rec = audit.recommendation;
    applyReviewerAction('ACCEPT', {
      decision: rec.recommendedAction === 'REQUEST_MORE_INFORMATION' ? 'MANUAL_REVIEW' : rec.recommendedAction,
      tier: rec.recommendedTier,
      limitKwd: rec.recommendedLimitKwd,
    });
  };

  const requestMoreInfo = () => {
    applyReviewerAction('REQUEST_MORE_INFO', { decision: 'MANUAL_REVIEW', tier: null, limitKwd: null });
  };

  const submitOverride = () => {
    if (!overrideReason.trim()) {
      window.alert('An Override Reason is required.');
      return;
    }
    applyReviewerAction(
      'OVERRIDE',
      { decision: overrideDecision, tier: overrideDecision === 'APPROVE' ? overrideTier || null : null, limitKwd: overrideDecision === 'APPROVE' && overrideLimit !== '' ? Number(overrideLimit) : null },
      overrideReason.trim()
    );
  };

  const reviewed = Boolean(audit?.reviewerAction);
  const rec = audit?.recommendation;

  return (
    <Card
      title="AI Manual Review Advisor"
      desc="Advisory only — this recommendation never becomes a final decision without explicit reviewer confirmation. The deterministic engine result above is unchanged."
    >
      {!audit && (
        <div>
          <p className="muted" style={{ marginBottom: 10 }}>Manual Review Required. Run the AI Advisor to get a recommendation, risk factors, and missing-information summary for the reviewer.</p>
          <Button variant="primary" onClick={runReview} disabled={running}>{running ? 'Running AI Review…' : 'Run AI Review'}</Button>
        </div>
      )}

      {audit && (audit.status !== 'OK' || !rec) && (
        <div>
          <p className="small-note" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
            ⚠ <strong>AI Advisor Unavailable</strong> — Manual reviewer action required.
            {audit.errorMessage && <><br />{audit.status}: {audit.errorMessage}</>}
          </p>
          <div style={{ marginTop: 8 }}><Button onClick={runReview} disabled={running}>{running ? 'Retrying…' : 'Retry AI Review'}</Button></div>
        </div>
      )}

      {audit && rec && (
        <div>
          <div className="grid grid-4" style={{ marginBottom: 14 }}>
            <div>
              <div className="kpi-label">Recommended Action</div>
              <div className="kpi-value" style={{ fontSize: 18 }}><span className={`badge ${actionBadgeClass(rec.recommendedAction)}`}>{ACTION_LABEL[rec.recommendedAction]}</span></div>
            </div>
            <div><div className="kpi-label">Recommended Tier</div><div className="kpi-value" style={{ fontSize: 18 }}>{rec.recommendedTier ?? '—'}</div></div>
            <div><div className="kpi-label">Recommended Limit</div><div className="kpi-value" style={{ fontSize: 18 }}>{rec.recommendedLimitKwd !== null ? formatKwd(rec.recommendedLimitKwd) : '—'}</div></div>
            <div><div className="kpi-label">Confidence</div><div className="kpi-value" style={{ fontSize: 18 }}>{CONFIDENCE_LABEL[rec.confidence]}</div></div>
          </div>

          {audit.policyViolations.length > 0 && (
            <p className="small-note" style={{ marginBottom: 12, borderColor: 'var(--amber, #c9902b)', color: '#8a6416' }}>
              ⚠ Policy guardrail applied: {audit.policyViolations.join(' ')}
            </p>
          )}

          <div className="grid grid-2" style={{ marginBottom: 12 }}>
            <div>
              <p className="card-title" style={{ fontSize: 13, marginBottom: 6 }}>Positive Factors</p>
              {rec.positiveFactors.length === 0 ? <p className="muted">None identified.</p> : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>{rec.positiveFactors.map((f, i) => <li key={i} style={{ color: 'var(--green)' }}>{f}</li>)}</ul>
              )}
            </div>
            <div>
              <p className="card-title" style={{ fontSize: 13, marginBottom: 6 }}>Risk Factors</p>
              {rec.riskFactors.length === 0 ? <p className="muted">None identified.</p> : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>{rec.riskFactors.map((f, i) => <li key={i} style={{ color: 'var(--red)' }}>{f}</li>)}</ul>
              )}
            </div>
          </div>

          {rec.missingInformation.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p className="card-title" style={{ fontSize: 13, marginBottom: 6 }}>Missing Information</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{rec.missingInformation.map((f, i) => <li key={i} className="muted">{f}</li>)}</ul>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <p className="card-title" style={{ fontSize: 13, marginBottom: 4 }}>AI Explanation</p>
            <p>{rec.summary}</p>
            <p className="muted" style={{ marginTop: 4 }}>{rec.recommendedActionReason}</p>
          </div>

          {rec.reasonCodes.length > 0 && (
            <div className="pill-btn-group" style={{ marginBottom: 12 }}>
              {rec.reasonCodes.map((c) => <span key={c} className="badge badge-neutral mono">{c}</span>)}
            </div>
          )}

          <div className="divider" />

          {!reviewed ? (
            <div>
              <div className="field-group" style={{ maxWidth: 260 }}>
                <label className="field-label">Reviewer Name</label>
                <input type="text" placeholder="Demo Reviewer" value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} />
              </div>
              <div className="flex-row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                <Button variant="primary" onClick={acceptRecommendation}>Accept Recommendation</Button>
                <Button onClick={() => setOverrideOpen((v) => !v)}>Override Decision</Button>
                <Button onClick={requestMoreInfo}>Request More Information</Button>
              </div>

              {overrideOpen && (
                <div className="card" style={{ boxShadow: 'none', marginTop: 10 }}>
                  <p className="card-title" style={{ marginBottom: 8, fontSize: 13 }}>Override Decision</p>
                  <div className="grid grid-3">
                    <div className="field-group">
                      <label className="field-label">Final Decision</label>
                      <select value={overrideDecision} onChange={(e) => setOverrideDecision(e.target.value as typeof overrideDecision)}>
                        <option value="APPROVE">APPROVE</option>
                        <option value="REJECT">REJECT</option>
                        <option value="MANUAL_REVIEW">MANUAL REVIEW (still pending)</option>
                      </select>
                    </div>
                    {overrideDecision === 'APPROVE' && (
                      <>
                        <div className="field-group">
                          <label className="field-label">Final Tier</label>
                          <input type="text" value={overrideTier} onChange={(e) => setOverrideTier(e.target.value)} placeholder="e.g. Tier C" />
                        </div>
                        <div className="field-group">
                          <label className="field-label">Final Limit (KWD)</label>
                          <input type="number" value={overrideLimit} onChange={(e) => setOverrideLimit(e.target.value)} />
                        </div>
                      </>
                    )}
                  </div>
                  <div className="field-group">
                    <label className="field-label">Override Reason (required)</label>
                    <input type="text" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. Unable to verify required financial information." />
                  </div>
                  <Button variant="primary" onClick={submitOverride}>Submit Override</Button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <p className="card-title" style={{ fontSize: 13, marginBottom: 6 }}>Reviewer Confirmation</p>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    <tr><td>AI Recommendation</td><td>{ACTION_LABEL[rec.recommendedAction]}{rec.recommendedTier ? ` / ${rec.recommendedTier}` : ''}{rec.recommendedLimitKwd !== null ? ` / ${formatKwd(rec.recommendedLimitKwd)}` : ''}</td></tr>
                    <tr><td>Reviewer Action</td><td><span className="badge badge-approve">{audit.reviewerAction?.replace(/_/g, ' ')}</span></td></tr>
                    <tr><td>Final Decision</td><td>{audit.reviewerFinalDecision?.decision}{audit.reviewerFinalDecision?.tier ? ` / ${audit.reviewerFinalDecision.tier}` : ''}{audit.reviewerFinalDecision?.limitKwd !== null && audit.reviewerFinalDecision?.limitKwd !== undefined ? ` / ${formatKwd(audit.reviewerFinalDecision.limitKwd)}` : ''}</td></tr>
                    {audit.reviewerOverrideReason && <tr><td>Override Reason</td><td>{audit.reviewerOverrideReason}</td></tr>}
                    <tr><td>Reviewer</td><td>{audit.reviewerUserName}</td></tr>
                    <tr><td>Confirmed At</td><td>{audit.reviewerActionAt}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
