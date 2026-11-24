import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfigStore } from '../hooks/ConfigContext';
import { Card, KpiTile, EmptyState, Button, DecisionBadge } from '../components/ui';
import { BarList } from '../components/BarList';
import { StackedBarRow } from '../components/StackedBar';
import { getAiAuditRecords } from '../storage/aiAdvisorStorage';
import { formatKwd, formatPercent, formatScore, formatDateTime, maskCivilId } from '../utils/format';
import {
  DEFAULT_DASHBOARD_FILTERS,
  filterDecisions,
  computeDashboardStats,
  segmentLabel,
  type DashboardFilters,
} from '../engine/dashboardAnalytics';
import type { AiAdvisorAuditRecord } from '../models/aiAdvisor';

const AI_ACTION_LABEL: Record<string, string> = {
  APPROVE: 'Recommended Approve',
  REJECT: 'Recommended Reject',
  REQUEST_MORE_INFORMATION: 'Recommended More Information',
};

export default function DashboardPage() {
  const { activeConfig, history } = useConfigStore();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_DASHBOARD_FILTERS);

  // AI audits are read once per visit to this page (consistent with how ResultPage reads
  // them directly from storage) — cheap, and always fresh whenever the Dashboard route
  // is actually navigated to.
  const allAudits = useMemo<AiAdvisorAuditRecord[]>(() => getAiAuditRecords(), []);
  const auditsByDecision = useMemo(() => new Map(allAudits.map((a) => [a.decisionId, a])), [allAudits]);

  const filteredHistory = useMemo(
    () => filterDecisions(history, filters, auditsByDecision),
    [history, filters, auditsByDecision]
  );
  const filteredAudits = useMemo(() => {
    const ids = new Set(filteredHistory.map((d) => d.id));
    return allAudits.filter((a) => ids.has(a.decisionId));
  }, [allAudits, filteredHistory]);

  const stats = useMemo(
    () => computeDashboardStats(filteredHistory, filteredAudits, activeConfig),
    [filteredHistory, filteredAudits, activeConfig]
  );

  // Filter dropdown option lists — always derived from actual data + current config,
  // never a hard-coded segment/tier list.
  const segmentOptions = useMemo(() => {
    const ids = new Set<string>(activeConfig.segments.map((s) => s.id));
    history.forEach((d) => { if (d.originalSegmentId) ids.add(d.originalSegmentId); });
    return Array.from(ids).map((id) => ({ id, label: segmentLabel(activeConfig, id) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [activeConfig, history]);

  const tierOptions = useMemo(() => {
    const tiers = new Set<string>();
    history.forEach((d) => { if (d.tier) tiers.add(d.tier); });
    return Array.from(tiers).sort();
  }, [history]);

  const resetFilters = () => setFilters(DEFAULT_DASHBOARD_FILTERS);
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(DEFAULT_DASHBOARD_FILTERS);

  const recentDecisions = filteredHistory.slice(0, 20);

  if (history.length === 0) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Decision Engine Dashboard</h1>
          <p className="page-subtitle">Business overview of every local decisioning simulation.</p>
        </div>
        <Card><EmptyState>No simulations yet. Head to the Customer Playground to run your first decision.</EmptyState></Card>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Decision Engine Dashboard</h1>
        <p className="page-subtitle">
          Business overview of every local decisioning simulation ({stats.totalDecisions} total
          {stats.nonCreditRouteCount > 0 && `, ${stats.nonCreditRouteCount} non-credit routes excluded from BNPL rates`}).
        </p>
      </div>

      {/* --- Filters --- */}
      <Card title="Filters" actions={<Button size="sm" onClick={resetFilters} disabled={!filtersActive}>Reset Filters</Button>}>
        <div className="grid grid-4">
          <div className="field-group">
            <label className="field-label">Date From</label>
            <input type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
          </div>
          <div className="field-group">
            <label className="field-label">Date To</label>
            <input type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
          </div>
          <div className="field-group">
            <label className="field-label">Segment</label>
            <select value={filters.segmentId} onChange={(e) => setFilters((f) => ({ ...f, segmentId: e.target.value }))}>
              <option value="">All Segments</option>
              {segmentOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Decision</label>
            <select value={filters.decision} onChange={(e) => setFilters((f) => ({ ...f, decision: e.target.value as DashboardFilters['decision'] }))}>
              <option value="ALL">All Decisions</option>
              <option value="APPROVE">Approved</option>
              <option value="MANUAL_REVIEW">Manual Review</option>
              <option value="REJECT">Rejected</option>
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Tier</label>
            <select value={filters.tier} onChange={(e) => setFilters((f) => ({ ...f, tier: e.target.value }))}>
              <option value="">All Tiers</option>
              {tierOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">AI Review Status</label>
            <select value={filters.aiReviewStatus} onChange={(e) => setFilters((f) => ({ ...f, aiReviewStatus: e.target.value as DashboardFilters['aiReviewStatus'] }))}>
              <option value="ALL">All</option>
              <option value="NOT_REVIEWED">Not Reviewed by AI</option>
              <option value="PENDING">AI Reviewed — Pending Confirmation</option>
              <option value="ACCEPTED">Reviewer Accepted</option>
              <option value="OVERRIDDEN">Reviewer Overridden</option>
            </select>
          </div>
        </div>
      </Card>

      {filteredHistory.length === 0 ? (
        <Card><EmptyState>No decisions match the current filters.</EmptyState></Card>
      ) : (
        <>
          {/* --- Row 1: KPIs --- */}
          <div className="grid grid-4">
            <KpiTile label="Total Decisions" value={String(stats.bnplDecisionCount)} />
            <KpiTile label="Approval Rate" value={formatPercent(stats.approvalRate)} />
            <KpiTile label="Manual Review Rate" value={formatPercent(stats.manualReviewRate)} />
            <KpiTile label="Rejection Rate" value={formatPercent(stats.rejectRate)} />
          </div>
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <KpiTile label="Average Score" value={formatScore(stats.avgScore)} sub={stats.decisionsWithoutScore > 0 ? `${stats.decisionsWithoutScore} decision(s) had no score computed` : undefined} />
            <KpiTile label="Average Approved Limit" value={formatKwd(stats.avgApprovedLimit)} />
          </div>

          {/* --- Row 2: Funnel + Outcome --- */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <Card title="Decision Funnel" desc="How customers moved through the decision journey.">
              <div className="stack-sm">
                <div className="flex-between"><span>Total Decisions</span><strong>{stats.funnel.total}</strong></div>
                <div className="muted" style={{ fontSize: 12 }}>↓</div>
                <div className="flex-between"><span>Passed Eligibility / Hard Gates</span><strong>{stats.funnel.passedEligibility}</strong></div>
                <div className="muted" style={{ fontSize: 12 }}>↓</div>
                <div className="flex-between"><span>Scored</span><strong>{stats.funnel.scored}</strong></div>
                <div className="muted" style={{ fontSize: 12 }}>↓</div>
                <div className="flex-between"><span style={{ color: 'var(--green)' }}>Approved</span><strong style={{ color: 'var(--green)' }}>{stats.funnel.approved}</strong></div>
                <div className="flex-between"><span style={{ color: 'var(--amber)' }}>Manual Review</span><strong style={{ color: 'var(--amber)' }}>{stats.funnel.manualReview}</strong></div>
                <div className="flex-between"><span style={{ color: 'var(--red)' }}>Rejected</span><strong style={{ color: 'var(--red)' }}>{stats.funnel.rejected}</strong></div>
              </div>
            </Card>
            <Card title="Decision Outcome" desc="Approved vs. Manual Review vs. Rejected — never mixed with Tier.">
              <BarList items={stats.outcomeDistribution} />
            </Card>
          </div>

          {/* --- Row 3: Segment breakdown + Tier distribution --- */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <Card title="Decisions by Segment" desc="Outcome breakdown per segment — segments shown are exactly whatever is currently configured or appears in history.">
              {stats.segmentBreakdown.length === 0 ? <EmptyState>No segment data yet.</EmptyState> : stats.segmentBreakdown.map((row) => (
                <StackedBarRow
                  key={row.segmentId || 'none'}
                  label={row.label}
                  total={row.total}
                  segments={[
                    { label: 'Approved', value: row.approved, color: '#12805c' },
                    { label: 'Manual Review', value: row.manualReview, color: '#b25e09' },
                    { label: 'Rejected', value: row.rejected, color: '#b3261e' },
                  ]}
                />
              ))}
            </Card>
            <Card title="Approved Tier Distribution" desc="Approved decisions only — Tier A/B/C names are read from the segment's own configured Decision Bands.">
              {stats.tierDistribution.length === 0 ? <EmptyState>No approved decisions yet.</EmptyState> : <BarList items={stats.tierDistribution} />}
            </Card>
          </div>

          {/* --- Row 4: Credit limit analytics --- */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <Card title="Average Approved Limit by Segment" desc="Approved decisions with a real credit limit only.">
              {stats.avgLimitBySegment.length === 0 ? <EmptyState>No approved credit limits yet.</EmptyState> : (
                <BarList items={stats.avgLimitBySegment.map((r) => ({ label: r.label, value: Math.round(r.avgLimit) }))} unit=" KWD" />
              )}
            </Card>
            <Card title="Approved Credit Limit Distribution" desc={`Bucketed against the current Global Maximum BNPL Limit (${formatKwd(activeConfig.globalSettings.globalMaxBnplLimit)}).`}>
              <BarList items={stats.creditLimitBuckets} />
            </Card>
          </div>

          {/* --- Row 5: Score distribution + Top reasons --- */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <Card title="Score Distribution" desc={stats.decisionsWithoutScore > 0 ? `Decisions without a score: ${stats.decisionsWithoutScore}` : undefined}>
              <BarList items={stats.scoreBuckets} />
            </Card>
            <Card title="Top Decision Reasons" desc="Business-friendly reasons — hover a code for the technical detail.">
              {stats.topReasons.length === 0 ? <EmptyState>No reason codes recorded yet.</EmptyState> : (
                <div className="stack-sm">
                  {stats.topReasons.map((r) => (
                    <div key={r.code} className="flex-between" title={r.code}>
                      <span>{r.label}</span>
                      <span className="badge badge-neutral mono">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* --- Row 6: AI performance + Manual Review reasons --- */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <Card title="AI Manual Review Performance" desc="Advisory-only — every number here reflects actual AI Advisor invocations, never a projection.">
              {!stats.ai.hasAnyAudits ? <EmptyState>No AI manual reviews have been completed yet.</EmptyState> : (
                <div className="grid grid-2">
                  <KpiTile label="Total Manual Review Cases" value={String(stats.ai.totalManualReviewCases)} />
                  <KpiTile label="AI Reviews Run" value={String(stats.ai.reviewsRun)} />
                  <KpiTile label="AI Recommended Approve" value={String(stats.ai.recommendedApprove)} />
                  <KpiTile label="AI Recommended Reject" value={String(stats.ai.recommendedReject)} />
                  <KpiTile label="AI Recommended More Info" value={String(stats.ai.recommendedMoreInfo)} />
                  <KpiTile label="Average AI Confidence" value={stats.ai.avgConfidenceLabel ?? '—'} />
                  <KpiTile label="Pending Human Confirmation" value={String(stats.ai.pendingConfirmation)} />
                  <KpiTile label="Accepted Recommendations" value={String(stats.ai.accepted)} />
                  <KpiTile label="Overridden Recommendations" value={String(stats.ai.overridden)} />
                </div>
              )}
            </Card>
            <Card title="Why Cases Go to Manual Review" desc="Most common causes among Manual Review decisions — one case may have more than one cause.">
              {stats.manualReviewReasons.length === 0 ? <EmptyState>No Manual Review decisions in the current filter.</EmptyState> : (
                <BarList items={stats.manualReviewReasons.map((r) => ({ label: r.label, value: r.count }))} />
              )}
            </Card>
          </div>

          {/* --- Row 7: Recent decisions --- */}
          <div style={{ marginTop: 16 }}>
            <Card title="Recent Decisions" desc={`Latest ${recentDecisions.length} of ${filteredHistory.length} matching decisions — click a row for the full explanation.`}>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Date / Time</th><th>Civil ID</th><th>Segment</th><th>Score</th><th>Decision</th><th>Tier</th><th>Credit Limit</th><th>AI Review</th></tr>
                  </thead>
                  <tbody>
                    {recentDecisions.map((d) => {
                      const audit = auditsByDecision.get(d.id);
                      const aiCell = !audit || audit.status !== 'OK' || !audit.recommendation
                        ? '—'
                        : `${AI_ACTION_LABEL[audit.recommendation.recommendedAction]}${audit.reviewerAction ? ` (${audit.reviewerAction === 'ACCEPT' ? 'Accepted' : audit.reviewerAction === 'OVERRIDE' ? 'Overridden' : 'More Info Requested'})` : ' — Pending'}`;
                      return (
                        <tr key={d.id} className="clickable" onClick={() => navigate(`/result/${d.id}`)}>
                          <td>{formatDateTime(d.createdAt)}</td>
                          <td className="mono">{maskCivilId(d.customer.civil_id as string)}</td>
                          <td>{segmentLabel(activeConfig, d.originalSegmentId)}</td>
                          <td>{hasScoreCell(d)}</td>
                          <td><DecisionBadge outcome={d.decisionOutcome} /></td>
                          <td>{d.tier ?? '—'}</td>
                          <td>{d.creditLimitCalculation ? formatKwd(d.creditLimit) : '—'}</td>
                          <td className="muted" style={{ fontSize: 12.5 }}>{aiCell}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function hasScoreCell(d: { scoringBreakdown: unknown[]; finalScore: number }): string {
  return d.scoringBreakdown.length > 0 ? formatScore(d.finalScore) : '—';
}
