import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useConfigStore } from '../hooks/ConfigContext';
import { Card, DecisionBadge, Button, EmptyState } from '../components/ui';
import { ScoreBar } from '../components/ScoreBar';
import { getConfigurationById, getDecisionById } from '../storage/localStorageService';
import { computeScore } from '../engine/scoringEngine';
import { matchDecisionBand, computeCreditLimit, getTierCreditLimit } from '../engine/creditLimitEngine';
import { formatKwd, formatScore, formatPercent, maskCivilId, formatDateTime, formatDate } from '../utils/format';
import type { CustomerRecord } from '../models/customer';
import { deriveResidencyFields, RESIDENCY_STABILITY_LABELS, RESIDENCY_STATUS_LABELS } from '../utils/residency';
import { NATIONALITY_LABELS } from '../data/nationalities';
import { DecisionFlowVisualization } from '../components/DecisionFlowVisualization';
import type { FlowStep } from '../components/DecisionFlowVisualization';
import { applyPreapprovedDecisionFloor, getLowestApprovedBand } from '../engine/preapprovedEngine';
import { PREAPPROVED_MATCH_LABELS } from '../models/preapproved';
import type { PreapprovedMatchStatus } from '../models/preapproved';
import type { DecisionOutcome } from '../models/configuration';
import type { DecisionResult } from '../models/decision';
import { computeDebtToIncome, formatDtiPercent } from '../utils/dti';
import { formatCurrentDelinquency } from '../utils/cinetDelinquency';
import { WORST_ACCOUNT_STATUS_LABELS, CINET_STATUS_LABELS } from '../models/cinet';
import { AiAdvisorCard } from '../components/AiAdvisorCard';
import { getAiAuditForDecision } from '../storage/aiAdvisorStorage';
import type { AiAdvisorAuditRecord } from '../models/aiAdvisor';

/**
 * A genuine audit/explanation trace: Customer → Nationality → Segment Routing → Segment
 * Hard Gates (each shown individually — Passed / Failed / Data Unavailable / Not
 * Applicable) → Hard Gates Passed → Scoring → Final Score → Decision Band → Outcome →
 * Tier → Credit Limit Rules breakdown → Final Credit Limit. Nothing here is invented —
 * every step reads directly from the stored DecisionResult. For a Manual Review case, the
 * AI Advisor's recommendation (never a finalized decision) is appended, ending in either
 * "Awaiting Reviewer Confirmation" or the reviewer's own recorded action.
 */
function buildFlowSteps(decision: DecisionResult, segmentName: string, aiAudit?: AiAdvisorAuditRecord): FlowStep[] {
  const identityOk = decision.customer.civil_id_status === 'VALID';
  const steps: FlowStep[] = [
    { label: 'Customer' },
    identityOk
      ? { label: 'PACI Verified', tone: 'good' }
      : { label: 'Identity Not Verified', tone: 'warn' },
  ];

  if (decision.preapprovedMatchStatus !== 'not_matched') {
    steps.push({ label: 'Preapproved Match ✓', detail: PREAPPROVED_MATCH_LABELS[decision.preapprovedMatchStatus], tone: 'good' });
  } else {
    steps.push({ label: 'Not Preapproved', tone: 'neutral' });
  }

  const nationality = NATIONALITY_LABELS[decision.customer.nationality as string] ?? String(decision.customer.nationality ?? 'Unknown');
  steps.push({ label: `Nationality: ${nationality}` });

  if (!decision.originalSegmentId) {
    // Minimum Age is a prerequisite evaluated before any segment is determined — no
    // segment, no segment-specific Hard Gates were ever reached for this customer.
    const gate = decision.hardGateResults[0];
    steps.push({ label: 'Segment Routing', detail: 'Not reached — Minimum Age failed first', tone: 'bad' });
    if (gate) steps.push({ label: gate.name, detail: `Actual: ${gate.actualValue ?? 'unavailable'}`, tone: 'bad' });
    steps.push({ label: 'Rejected', tone: 'bad' });
    return steps;
  }

  steps.push({ label: `Segment Routing: Age ${decision.customer.age ?? '—'} → ${segmentName}` });
  steps.push({ label: `${segmentName} Hard Gates` });

  for (const g of decision.hardGateResults) {
    if (!g.applicable) {
      steps.push({ label: g.name, detail: `Not Applicable — ${g.skipReason ?? 'skipped'}`, tone: 'neutral' });
    } else if (g.indeterminate) {
      steps.push({ label: g.name, detail: `Data Unavailable — ${g.reasonCode ?? 'routed to Manual Review'}`, tone: 'warn' });
    } else if (!g.passed) {
      steps.push({ label: g.name, detail: `Failed — ${g.reasonCode ?? ''}`, tone: 'bad' });
    } else {
      steps.push({ label: g.name, detail: 'Passed', tone: 'good' });
    }
  }

  if (decision.hardGateFailed) {
    steps.push({ label: 'Rejected', tone: 'bad' });
    return steps;
  }
  steps.push({ label: 'Hard Gates Passed', tone: 'good' });

  if (!decision.scoringModelId) {
    steps.push({ label: 'No BNPL Credit', detail: 'Segment does not carry a credit line', tone: 'neutral' });
    return steps;
  }

  steps.push({ label: 'Scoring' });
  steps.push({ label: `Final Score: ${(decision.finalScore * 100).toFixed(1)}` });
  steps.push({
    label: decision.originalDecisionOutcome.replace('_', ' '),
    tone: decision.originalDecisionOutcome === 'APPROVE' ? 'good' : decision.originalDecisionOutcome === 'REJECT' ? 'bad' : 'warn',
  });
  if (decision.originalDecisionOutcome === 'APPROVE' && decision.originalTier) {
    steps.push({ label: decision.originalTier, tone: 'good' });
  }

  if (decision.preapprovedOverrideApplied) {
    steps.push({ label: 'Preapproved Floor Applied', tone: 'good' });
    steps.push({ label: `${decision.tier ?? 'Tier'} Approved`, tone: 'good' });
  } else if (decision.preapprovedMatchStatus !== 'not_matched') {
    steps.push({ label: 'No Preapproval Adjustment', tone: 'neutral' });
  }

  if (decision.creditLimitCalculation) {
    steps.push({ label: `Tier Credit Limit: ${decision.creditLimitCalculation.tierCreditLimit ?? '—'} KWD` });
    steps.push({ label: `Segment Cap: ${decision.creditLimitCalculation.segmentMaxLimit} KWD` });
    steps.push({ label: `Global Cap: ${decision.creditLimitCalculation.globalMaxLimit} KWD` });
    if (decision.creditLimitCalculation.configError) {
      steps.push({ label: 'Configuration Error', detail: decision.creditLimitCalculation.configErrorReason, tone: 'bad' });
    }
    steps.push({ label: `Final Credit Limit: ${decision.creditLimitCalculation.finalLimit} KWD`, tone: decision.creditLimitCalculation.configError ? 'bad' : 'good' });
  } else if (decision.decisionOutcome === 'MANUAL_REVIEW') {
    steps.push({ label: 'Automatic Credit Limit: Not Granted', tone: 'warn' });
  } else {
    steps.push({ label: `Final Credit Limit: ${decision.creditLimit} KWD`, tone: 'neutral' });
  }

  if (decision.decisionOutcome === 'MANUAL_REVIEW' && aiAudit) {
    steps.push({ label: 'AI Advisor' });
    if (aiAudit.status !== 'OK' || !aiAudit.recommendation) {
      steps.push({ label: 'AI Advisor Unavailable', detail: 'Manual reviewer action required.', tone: 'warn' });
    } else {
      const rec = aiAudit.recommendation;
      steps.push({
        label: `Recommended: ${rec.recommendedAction.replace(/_/g, ' ')}`,
        tone: rec.recommendedAction === 'APPROVE' ? 'good' : rec.recommendedAction === 'REJECT' ? 'bad' : 'warn',
      });
      if (rec.recommendedTier) steps.push({ label: rec.recommendedTier, tone: 'good' });
      if (rec.recommendedLimitKwd !== null) steps.push({ label: `Recommended Limit ${rec.recommendedLimitKwd} KWD` });
      steps.push(
        aiAudit.reviewerAction
          ? { label: `Reviewer Confirmed: ${aiAudit.reviewerFinalDecision?.decision ?? aiAudit.reviewerAction}`, tone: 'good' }
          : { label: 'Awaiting Reviewer Confirmation', tone: 'warn' }
      );
    }
  }
  return steps;
}

const WHAT_IF_FIELDS: { key: string; label: string; type: 'number' | 'categorical' | 'date'; options?: string[] }[] = [
  { key: 'monthly_income', label: 'Monthly Income', type: 'number' },
  { key: 'student_allowance', label: 'Verified Student Allowance', type: 'number' },
  { key: 'cinet_score', label: 'CINET Score', type: 'number' },
  { key: 'employment_tenure_months', label: 'Employment Tenure (months)', type: 'number' },
  { key: 'monthly_debt_obligations', label: 'Monthly Debt Obligations (KWD)', type: 'number' },
  { key: 'employer_tier', label: 'Employer Tier', type: 'categorical', options: ['government', 'large_corp', 'sme', 'self_employed', 'unknown'] },
  { key: 'residency_start_date', label: 'Residency Start Date', type: 'date' },
  { key: 'residency_expiry_date', label: 'Residency Expiry Date', type: 'date' },
];

export default function ResultPage() {
  const { id } = useParams();
  const { activeConfig } = useConfigStore();
  const decision = useMemo(() => (id ? getDecisionById(id) : undefined), [id]);
  const config = useMemo(
    () => (decision ? getConfigurationById(decision.configVersionId) ?? activeConfig : activeConfig),
    [decision, activeConfig]
  );

  const [whatIf, setWhatIf] = useState<CustomerRecord>({});
  const [simulatePreapproved, setSimulatePreapproved] = useState<'actual' | 'on' | 'off'>('actual');
  const [aiAudit, setAiAudit] = useState<AiAdvisorAuditRecord | undefined>(() => (decision ? getAiAuditForDecision(decision.id) : undefined));

  const segment = decision ? config.segments.find((s) => s.id === decision.originalSegmentId) : undefined;
  const bands = decision?.scoringModelId ? config.decisionBands[decision.scoringModelId] ?? [] : [];
  const model = decision?.scoringModelId ? config.scoringModels[decision.scoringModelId] : undefined;
  // The band the raw score actually falls in (STEP 2) — independent of any preapproved floor promotion.
  const matchedBand = decision && bands.length > 0 ? matchDecisionBand(bands, decision.finalScore) : null;

  const whatIfOutcome = useMemo(() => {
    if (!model || !decision) return null;
    const whatIfMerged: CustomerRecord = { ...decision.customer, ...whatIf };
    // Residency dates may have changed — re-derive duration/remaining/stability before scoring.
    // Never re-derives anything from nationality.
    Object.assign(whatIfMerged, deriveResidencyFields(whatIfMerged));
    // Debt-to-Income is always re-derived from obligations ÷ income — never edited directly.
    if (config.globalSettings.dtiSourceMode === 'bnpl_payment') {
      whatIfMerged.monthly_debt_obligations = whatIfMerged.total_monthly_bnpl_payment ?? null;
    }
    whatIfMerged.debt_to_income = computeDebtToIncome(whatIfMerged);
    const scoring = computeScore(model, whatIfMerged);
    const band = matchDecisionBand(bands, scoring.finalScore);
    let originalOutcome: DecisionOutcome = band?.outcome ?? 'MANUAL_REVIEW';
    const missingTriggered = scoring.unavailableWeightPct > config.globalSettings.manualReviewMissingWeightThreshold;
    if (missingTriggered && originalOutcome === 'APPROVE') originalOutcome = 'MANUAL_REVIEW';
    // A Tier is only ever meaningful alongside an Approve outcome — see the identical fix
    // in the decision engine (decisionEngine.ts) for why this must never carry a stale
    // Tier once the outcome itself has been overridden to Manual Review.
    const originalTier = originalOutcome === 'APPROVE' ? band?.tier ?? null : null;

    // Preapproval never touches the score itself — only whether the decision floor applies.
    const simulatedMatchStatus: PreapprovedMatchStatus =
      simulatePreapproved === 'actual' ? decision.preapprovedMatchStatus : simulatePreapproved === 'on' ? 'matched_civil_id' : 'not_matched';
    const floorResult = applyPreapprovedDecisionFloor({
      policyEnabled: config.preapprovedMarketing.enabled,
      matchResult: { status: simulatedMatchStatus },
      hardGatePassed: !decision.hardGateFailed,
      segmentId: decision.originalSegmentId,
      originalDecision: originalOutcome,
      originalTier,
      decisionBands: bands,
    });

    const finalOutcome = floorResult.decisionOutcome;
    const effectiveBand = floorResult.applied ? getLowestApprovedBand(bands) : (originalOutcome === 'APPROVE' ? band : null);
    const rule = decision.scoringModelId ? config.creditLimitRules[decision.scoringModelId] : undefined;
    const segmentMaxLimit = rule?.segmentMaximumKwd ?? 0;
    const tierCreditLimit = decision.scoringModelId ? getTierCreditLimit(config.creditLimitRules, decision.scoringModelId, effectiveBand?.tier) : null;
    const calc = finalOutcome === 'APPROVE' ? computeCreditLimit(tierCreditLimit, segmentMaxLimit, config.globalSettings.globalMaxBnplLimit, effectiveBand?.tier) : null;
    return { scoring, band: effectiveBand, originalOutcome, finalOutcome, floorResult, calc };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(whatIf), model, decision, simulatePreapproved]);

  if (!decision) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Decision Result</h1></div>
        <Card><EmptyState>No decision found. Run the Customer Playground to generate one.</EmptyState></Card>
      </div>
    );
  }

  const hasWhatIf = Object.keys(whatIf).length > 0 || simulatePreapproved !== 'actual';

  return (
    <div>
      <div className="page-header">
        <div className="flex-between">
          <div>
            <h1 className="page-title">Decision Result</h1>
            <p className="page-subtitle">{formatDateTime(decision.createdAt)} · {maskCivilId(decision.customer.civil_id as string)}</p>
          </div>
          <DecisionBadge outcome={decision.decisionOutcome} />
        </div>
      </div>

      <div className="grid grid-4">
        <Card><div className="kpi-label">Segment</div><div className="kpi-value" style={{ fontSize: 18 }}>{segment?.name ?? decision.originalSegmentId}</div>
        </Card>
        <Card><div className="kpi-label">Final Score</div><div className="kpi-value">{formatScore(decision.finalScore)}</div></Card>
        <Card><div className="kpi-label">Tier</div><div className="kpi-value" style={{ fontSize: 18 }}>{decision.tier ?? '—'}</div></Card>
        <Card><div className="kpi-label">Credit Limit</div><div className="kpi-value" style={{ fontSize: 18 }}>{formatKwd(decision.creditLimit)}</div></Card>
      </div>

      <Card title="Decision Flow">
        <DecisionFlowVisualization steps={buildFlowSteps(decision, segment?.name ?? decision.originalSegmentId, aiAudit)} />
      </Card>

      {decision.decisionOutcome === 'MANUAL_REVIEW' && (
        <AiAdvisorCard decision={decision} config={config} audit={aiAudit} onAuditChange={setAiAudit} />
      )}

      <Card title="Assessment Type" desc="CINET Score is optional — a customer can receive a preliminary score without it and be re-assessed later once it becomes available.">
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              <tr><td>Assessment Type</td><td><span className={`badge ${decision.assessmentType === 'full' ? 'badge-approve' : 'badge-review'}`}>{decision.assessmentType === 'full' ? 'Full Credit Assessment' : 'Preliminary Credit Assessment'}</span></td></tr>
              <tr><td>CINET Status</td><td>{CINET_STATUS_LABELS[decision.cinetStatus]}</td></tr>
              <tr><td>CINET Score</td><td>{decision.cinetScore === null ? <span className="muted">unavailable</span> : String(decision.cinetScore)}</td></tr>
              <tr><td>Included in Scoring</td><td>{decision.cinetIncludedInScore ? 'Yes' : 'No — excluded, remaining factors re-weighted to 100%'}</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Preapproved Marketing Status">
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              <tr><td>Preapproved Customer</td><td>{decision.preapprovedMatchStatus !== 'not_matched' ? 'Yes' : 'No'}</td></tr>
              <tr><td>Match Method</td><td>{PREAPPROVED_MATCH_LABELS[decision.preapprovedMatchStatus]}</td></tr>
              <tr><td>Batch</td><td>{decision.preapprovedBatchName ?? '—'}</td></tr>
              <tr><td>Batch ID</td><td className="mono">{decision.preapprovedBatchId ?? '—'}</td></tr>
              <tr><td>Preapproved Entry ID</td><td className="mono">{decision.preapprovedEntryId ?? '—'}</td></tr>
              <tr><td>Original Decision</td><td><DecisionBadge outcome={decision.originalDecisionOutcome} /></td></tr>
              <tr><td>Original Tier</td><td>{decision.originalTier ?? '—'}</td></tr>
              <tr><td>Preapproval Override Applied</td><td>{decision.preapprovedOverrideApplied ? 'Yes' : 'No'}</td></tr>
              <tr><td>Override Mode</td><td>{decision.preapprovedOverrideApplied ? 'Floor to Lowest Approved Tier' : '—'}</td></tr>
              <tr><td>Final Decision</td><td><DecisionBadge outcome={decision.decisionOutcome} /></td></tr>
              <tr><td>Final Tier</td><td>{decision.tier ?? '—'}</td></tr>
            </tbody>
          </table>
        </div>
        {decision.preapprovedMatchStatus !== 'not_matched' && !decision.preapprovedOverrideApplied && (
          <p className="small-note" style={{ marginTop: 10 }}>
            {decision.hardGateFailed
              ? 'Hard gate failure cannot be overridden by preapproved status — the Minimum Age gate can never be bypassed by preapproval.'
              : decision.originalDecisionOutcome === 'APPROVE'
              ? 'Already approved by normal scoring — no promotion was needed.'
              : 'Preapproved policy is currently disabled.'}
          </p>
        )}
      </Card>

      <Card title="Customer Profile" desc="KYC / profile attributes shown for context. Nationality's role (Hard Gate and/or Scoring) is entirely configuration-driven — see Eligibility Rules and Scoring Breakdown below.">
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              <tr><td>Nationality</td><td>{NATIONALITY_LABELS[decision.customer.nationality as string] ?? String(decision.customer.nationality ?? '—')}</td></tr>
              <tr><td>Residency Status</td><td>{RESIDENCY_STATUS_LABELS[decision.customer.residency_status as string] ?? String(decision.customer.residency_status ?? '—')}</td></tr>
              <tr>
                <td>Residency Since</td>
                <td>
                  {decision.customer.residency_start_date
                    ? <>{new Date(String(decision.customer.residency_start_date)).getFullYear()} <span className="muted">(Source: PACI / Identity Provider)</span></>
                    : <span className="muted">Unavailable — not provided by any configured source</span>}
                </td>
              </tr>
              <tr><td>Residency Expiry</td><td>{decision.customer.residency_expiry_date ? formatDate(decision.customer.residency_expiry_date as string) : <span className="muted">Unavailable</span>}</td></tr>
              <tr>
                <td>Residency Duration</td>
                <td>
                  {decision.customer.residency_duration_years !== null && decision.customer.residency_duration_years !== undefined
                    ? `${decision.customer.residency_duration_years} years`
                    : <span className="muted">Unavailable — Residency Since not provided</span>}
                </td>
              </tr>
              <tr><td>Residency Remaining</td><td>{decision.customer.residency_remaining_months !== null && decision.customer.residency_remaining_months !== undefined ? `${decision.customer.residency_remaining_months} months` : <span className="muted">Unavailable — Residency Expiry not provided</span>}</td></tr>
              <tr>
                <td>Residency Stability</td>
                <td>
                  {RESIDENCY_STABILITY_LABELS[decision.customer.residency_stability_category as string] ?? String(decision.customer.residency_stability_category ?? '—')}
                  {decision.customer.residency_stability_category === 'unspecified' && <span className="muted"> (Residency Since not provided — never inferred from Residency Expiry)</span>}
                </td>
              </tr>
              <tr><td>Age</td><td>{String(decision.customer.age ?? '—')}</td></tr>
              <tr><td>Segment</td><td>{segment?.name ?? decision.originalSegmentId}</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="CINET Summary" desc="Credit bureau data as returned by the mock CINET integration.">
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              <tr><td>CINET Score</td><td>{decision.customer.cinet_score === null || decision.customer.cinet_score === undefined ? <span className="muted">unavailable</span> : String(decision.customer.cinet_score)}</td></tr>
              <tr><td>Active BNPL Accounts</td><td>{decision.customer.total_active_bnpl_accounts === null || decision.customer.total_active_bnpl_accounts === undefined ? <span className="muted">unavailable</span> : String(decision.customer.total_active_bnpl_accounts)}</td></tr>
              <tr><td>Monthly BNPL Payment</td><td>{decision.customer.total_monthly_bnpl_payment === null || decision.customer.total_monthly_bnpl_payment === undefined ? <span className="muted">unavailable</span> : formatKwd(decision.customer.total_monthly_bnpl_payment as number)}</td></tr>
              <tr><td>Overdue Amount</td><td>{decision.customer.total_overdue_bnpl_amount === null || decision.customer.total_overdue_bnpl_amount === undefined ? <span className="muted">unavailable</span> : formatKwd(decision.customer.total_overdue_bnpl_amount as number)}</td></tr>
              <tr><td>Worst Status</td><td>{WORST_ACCOUNT_STATUS_LABELS[decision.customer.worst_account_status as string] ?? (decision.customer.worst_account_status === null || decision.customer.worst_account_status === undefined ? <span className="muted">unavailable</span> : String(decision.customer.worst_account_status))}</td></tr>
              <tr><td>Current Delinquency</td><td>{formatCurrentDelinquency(decision.customer.current_delinquency as boolean | null)}</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      {bands.length > 0 && (
        <Card title="Score Visualization">
          <ScoreBar bands={bands} score={decision.finalScore} />
        </Card>
      )}

      <Card title="Segment Routing" desc="How the customer's age and profile determined their segment.">
        <p>Routed from segment <strong>{decision.originalSegmentId}</strong>{decision.finalSegmentId !== decision.originalSegmentId ? ` to ${decision.finalSegmentId}` : ''}. Product: {segment?.product ?? '—'}.</p>
      </Card>

      <Card title="Eligibility Rules (Hard Gates)" desc="Evaluated before scoring. Any failed gate rejects the application outright — segment-scoped rules (e.g. Student Nationality) only appear for the segments they apply to.">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Gate</th><th>Input</th><th>Actual Value</th><th>Result</th><th>Reason Code</th></tr></thead>
            <tbody>
              {decision.hardGateResults.map((g) => (
                <tr key={g.ruleId}>
                  <td>{g.name}</td>
                  <td className="mono">{g.input}</td>
                  <td>{g.actualValue === null ? <span className="muted">null</span> : String(g.actualValue)}</td>
                  <td>
                    {!g.applicable ? (
                      <span className="badge badge-neutral" title={g.skipReason}>Not Applicable</span>
                    ) : g.indeterminate ? (
                      <span className="badge badge-review">Unavailable</span>
                    ) : g.passed ? (
                      <span className="badge badge-approve">Pass</span>
                    ) : (
                      <span className="badge badge-reject">Fail</span>
                    )}
                  </td>
                  <td className="mono">{!g.applicable ? (g.skipReason ?? '—') : g.reasonCode ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>


      <Card title="Scoring Breakdown" desc="Configured Weight is the permanent model definition. Effective Weight is computed fresh for this decision — when a factor is excluded, the remaining factors' weights are re-normalized back to 100%.">
        {decision.scoringBreakdown.length === 0 ? (
          <EmptyState>No scoring model applied to this decision.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Factor</th><th>Raw Value</th><th>Method</th><th>Normalized</th><th>Configured Weight</th><th>Effective Weight</th><th>Contribution</th><th>Status</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {decision.scoringBreakdown.map((row) => {
                  const rawField = config.customerFields.find((f) => f.key === row.field);
                  const rawDisplay = row.missing
                    ? null
                    : row.field === 'debt_to_income'
                    ? formatDtiPercent(row.rawValue as number)
                    : rawField?.optionLabels?.[String(row.rawValue)] ?? String(row.rawValue);
                  return (
                    <tr key={row.field}>
                      <td>{row.displayName}</td>
                      <td>{row.excluded || row.missing ? <span className="muted">unavailable</span> : rawDisplay}</td>
                      <td className="mono">{row.method}</td>
                      <td>{row.excluded || row.normalizedScore === null ? <span className="muted">N/A</span> : row.normalizedScore.toFixed(2)}</td>
                      <td>{row.weight}%</td>
                      <td>{row.excluded || row.effectiveWeight === null ? <span className="muted">N/A</span> : `${row.effectiveWeight.toFixed(1)}%`}</td>
                      <td>{row.excluded ? <span className="muted">—</span> : `${(row.contribution * 100).toFixed(1)}`}</td>
                      <td>
                        {!row.excluded ? (
                          <span className="badge badge-approve">Included</span>
                        ) : row.missingDataBehavior === 'manual_review' ? (
                          <span className="badge badge-review">Manual Review Required</span>
                        ) : (
                          <span className="badge badge-neutral">Excluded</span>
                        )}
                      </td>
                      <td className="muted">{row.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {decision.unavailableWeightPct > 0 && (
          <p className="small-note" style={{ marginTop: 10 }}>{decision.unavailableWeightPct.toFixed(1)}% of scoring weight fell back to a neutral default at decision time.</p>
        )}
        {!decision.cinetIncludedInScore && decision.scoringBreakdown.some((r) => r.excluded) && (
          <p className="small-note" style={{ marginTop: 10 }}>CINET Score was not available and was excluded from this assessment — remaining available factors were re-weighted proportionally back to 100%. This did not penalize the customer.</p>
        )}
      </Card>

      <Card
        title="Decision Result Flow"
        desc="Final Score → Decision Band → Decision + Tier → Credit Limit Rules → Final Credit Limit. Decision Bands determine only the decision and tier; Credit Limit Rules are the only place a KWD amount is configured."
      >
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              <tr><td>STEP 1 · Final Score</td><td><strong>{formatPercent(decision.finalScore * 100)}</strong></td></tr>
              <tr>
                <td>STEP 2 · Decision Band</td>
                <td>{matchedBand ? `${formatPercent(matchedBand.min * 100)} – ${formatPercent(Math.min(1, matchedBand.max) * 100)}` : '—'}</td>
              </tr>
              <tr><td>STEP 3 · Decision</td><td><DecisionBadge outcome={decision.decisionOutcome} /></td></tr>
              <tr><td>STEP 4 · Tier</td><td>{decision.decisionOutcome === 'APPROVE' ? decision.tier ?? '—' : <span className="muted">Not assigned</span>}</td></tr>
              {decision.creditLimitCalculation ? (
                <>
                  <tr>
                    <td>STEP 5 · Credit Limit Rule</td>
                    <td>
                      {segment?.name ?? decision.originalSegmentId} / {decision.tier ?? '—'} ={' '}
                      {decision.creditLimitCalculation.tierCreditLimit !== null ? formatKwd(decision.creditLimitCalculation.tierCreditLimit) : '—'}
                    </td>
                  </tr>
                  <tr><td>STEP 6 · Segment Maximum</td><td>{formatKwd(decision.creditLimitCalculation.segmentMaxLimit)}</td></tr>
                  <tr><td>STEP 7 · Global Maximum</td><td>{formatKwd(decision.creditLimitCalculation.globalMaxLimit)}</td></tr>
                  {decision.creditLimitCalculation.configError && (
                    <tr>
                      <td><strong style={{ color: 'var(--red)' }}>⚠ Configuration Error</strong></td>
                      <td style={{ color: 'var(--red)' }}>{decision.creditLimitCalculation.configErrorReason}</td>
                    </tr>
                  )}
                  <tr><td><strong>FINAL CREDIT LIMIT</strong></td><td><strong>{formatKwd(decision.creditLimitCalculation.finalLimit)}</strong></td></tr>
                </>
              ) : decision.decisionOutcome === 'MANUAL_REVIEW' ? (
                <tr><td><strong>Manual Review Required</strong></td><td className="muted">No automatic credit limit is assigned until this decision is resolved to Approve.</td></tr>
              ) : (
                <tr><td><strong>FINAL CREDIT LIMIT</strong></td><td><strong>{formatKwd(0)}</strong></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="small-note" style={{ marginTop: 10 }}>The Global Maximum BNPL Limit is a configured demo value, not a verified real-world regulation.</p>
      </Card>

      <Card title="Reason Codes">
        {decision.reasonCodes.length === 0 ? <span className="muted">None</span> : (
          <div className="pill-btn-group">
            {decision.reasonCodes.map((code) => <span key={code} className="badge badge-neutral mono">{code}</span>)}
          </div>
        )}
      </Card>

      <Card title="Human Readable Explanation">
        <p>{decision.explanation}</p>
      </Card>

      {model && (
        <Card title="What-If Simulator" desc="Adjust financial inputs and see the score, decision, and limit recalculate immediately.">
          <div className="grid grid-3">
            {WHAT_IF_FIELDS.map((f) => (
              <div className="field-group" key={f.key}>
                <label className="field-label">{f.label}</label>
                {f.type === 'categorical' ? (
                  <select
                    value={String(whatIf[f.key] ?? decision.customer[f.key] ?? '')}
                    onChange={(e) => setWhatIf((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  >
                    {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : f.type === 'date' ? (
                  <input
                    type="date"
                    value={String(whatIf[f.key] ?? decision.customer[f.key] ?? '')}
                    onChange={(e) => setWhatIf((prev) => ({ ...prev, [f.key]: e.target.value || null }))}
                  />
                ) : (
                  <input
                    type="number"
                    value={String(whatIf[f.key] ?? decision.customer[f.key] ?? '')}
                    onChange={(e) => setWhatIf((prev) => ({ ...prev, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                  />
                )}
              </div>
            ))}
            <div className="field-group">
              <label className="field-label">Simulate Preapproved Match</label>
              <select value={simulatePreapproved} onChange={(e) => setSimulatePreapproved(e.target.value as 'actual' | 'on' | 'off')}>
                <option value="actual">Actual ({PREAPPROVED_MATCH_LABELS[decision.preapprovedMatchStatus]})</option>
                <option value="on">Force ON — Matched</option>
                <option value="off">Force OFF — Not Matched</option>
              </select>
            </div>
          </div>
          <p className="small-note">Preapproval never changes the raw score or its factor contributions — only whether a non-approve decision gets floored to the lowest approved tier.</p>

          {hasWhatIf && whatIfOutcome && (
            <>
              <div className="divider" />
              <div className="grid grid-4">
                <Card>
                  <div className="kpi-label">Score</div>
                  <div className="kpi-value" style={{ fontSize: 20 }}>{formatScore(decision.finalScore)} → {formatScore(whatIfOutcome.scoring.finalScore)}</div>
                </Card>
                <Card>
                  <div className="kpi-label">Decision</div>
                  <div className="flex-row" style={{ marginTop: 6 }}><DecisionBadge outcome={decision.decisionOutcome} /> → <DecisionBadge outcome={whatIfOutcome.finalOutcome} /></div>
                </Card>
                <Card>
                  <div className="kpi-label">Tier</div>
                  <div className="kpi-value" style={{ fontSize: 20 }}>{decision.tier ?? '—'} → {whatIfOutcome.band?.tier ?? '—'}</div>
                </Card>
                <Card>
                  <div className="kpi-label">Credit Limit</div>
                  <div className="kpi-value" style={{ fontSize: 20 }}>{formatKwd(decision.creditLimit)} → {formatKwd(whatIfOutcome.calc?.finalLimit ?? 0)}</div>
                </Card>
              </div>
              {whatIfOutcome.floorResult.applied && (
                <p className="small-note" style={{ marginTop: 10, borderColor: 'var(--green)', color: 'var(--green)' }}>
                  Preapproved floor applied: original decision was {whatIfOutcome.originalOutcome.replace('_', ' ')}, promoted to {whatIfOutcome.floorResult.tier}.
                </p>
              )}
              <div className="divider" />
              <p className="card-desc" style={{ marginBottom: 8 }}>Factors that changed:</p>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Factor</th><th>Old Normalized</th><th>New Normalized</th><th>Old Contribution</th><th>New Contribution</th></tr></thead>
                  <tbody>
                    {whatIfOutcome.scoring.rows.map((row) => {
                      const oldRow = decision.scoringBreakdown.find((r) => r.field === row.field);
                      if (!oldRow) return null;
                      const changed = oldRow.excluded !== row.excluded || Math.abs((oldRow.normalizedScore ?? 0) - (row.normalizedScore ?? 0)) > 0.001;
                      return (
                        <tr key={row.field} style={changed ? { background: 'var(--accent-soft)' } : undefined}>
                          <td>{row.displayName}</td>
                          <td>{oldRow.excluded || oldRow.normalizedScore === null ? <span className="muted">N/A</span> : oldRow.normalizedScore.toFixed(2)}</td>
                          <td>{row.excluded || row.normalizedScore === null ? <span className="muted">N/A</span> : row.normalizedScore.toFixed(2)}</td>
                          <td>{oldRow.excluded ? <span className="muted">—</span> : (oldRow.contribution * 100).toFixed(1)}</td>
                          <td>{row.excluded ? <span className="muted">—</span> : (row.contribution * 100).toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Button size="sm" onClick={() => setWhatIf({})} className="btn-sm" title="Reset">Reset What-If</Button>
            </>
          )}
        </Card>
      )}

      <div style={{ marginTop: 16 }}>
        <Link to="/decision-history"><Button>← Back to Decision History</Button></Link>
      </div>
    </div>
  );
}
