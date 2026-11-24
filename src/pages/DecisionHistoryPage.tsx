import { useNavigate } from 'react-router-dom';
import { useConfigStore } from '../hooks/ConfigContext';
import { Card, Button, DecisionBadge, EmptyState } from '../components/ui';
import { maskCivilId, formatDateTime, formatKwd, formatScore } from '../utils/format';
import { exportDecisionJson } from '../storage/localStorageService';

export default function DecisionHistoryPage() {
  const { history, clearHistory } = useConfigStore();
  const navigate = useNavigate();

  const handleExport = (decisionId: string) => {
    const decision = history.find((d) => d.id === decisionId);
    if (!decision) return;
    const json = exportDecisionJson(decision);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decision-${decisionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="page-header">
        <div className="flex-between">
          <div>
            <h1 className="page-title">Decision History</h1>
            <p className="page-subtitle">Every simulation run in this browser, most recent first.</p>
          </div>
          {history.length > 0 && <Button size="sm" variant="danger" onClick={() => { if (confirm('Clear all decision history?')) clearHistory(); }}>Clear History</Button>}
        </div>
      </div>

      <Card>
        {history.length === 0 ? (
          <EmptyState>No decisions yet. Run the Customer Playground to generate one.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th><th>Date</th><th>Civil ID</th><th>Age</th><th>Segment</th><th>Score</th><th>Decision</th><th>Tier</th><th>Limit</th><th>Config</th><th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => navigate(`/result/${d.id}`)}>
                    <td className="mono">{d.id.slice(0, 8)}</td>
                    <td>{formatDateTime(d.createdAt)}</td>
                    <td>{maskCivilId(d.customer.civil_id as string)}</td>
                    <td>{String(d.customer.age ?? '—')}</td>
                    <td>{d.originalSegmentId}</td>
                    <td>{formatScore(d.finalScore)}</td>
                    <td><DecisionBadge outcome={d.decisionOutcome} /></td>
                    <td>{d.tier ?? '—'}</td>
                    <td>{formatKwd(d.creditLimit)}</td>
                    <td className="muted">{d.configVersionLabel}</td>
                    <td onClick={(e) => e.stopPropagation()}><Button size="sm" onClick={() => handleExport(d.id)}>Export</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
