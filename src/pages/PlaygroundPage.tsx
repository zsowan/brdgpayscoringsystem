import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfigStore } from '../hooks/ConfigContext';
import { Button, Card } from '../components/ui';
import { WizardStepFields } from '../components/wizard/WizardStepFields';
import { FieldInput } from '../components/wizard/FieldInput';
import type { CustomerRecord } from '../models/customer';
import { SAMPLE_CUSTOMERS } from '../data/sampleCustomers';
import { resolveCustomerRecord } from '../utils/resolveCustomer';
import { runDecisionEngine } from '../engine/decisionEngine';
import { maskCivilId, formatDate } from '../utils/format';
import { deriveResidencyFields, RESIDENCY_STABILITY_LABELS } from '../utils/residency';
import { findPreapprovedMatch, getVerifiedCivilId } from '../engine/preapprovedEngine';
import { PREAPPROVED_MATCH_LABELS } from '../models/preapproved';
import { computeDebtToIncome, formatDtiPercent } from '../utils/dti';
import { deriveCurrentDelinquency, formatCurrentDelinquency } from '../utils/cinetDelinquency';
import { CINET_STATUS_LABELS, type CinetStatus } from '../models/cinet';

const STEPS = [
  { key: 'identity', label: '1. Identity' },
  { key: 'employment', label: '2. Employment & Financial' },
  { key: 'review', label: '3. Review' },
] as const;

export default function PlaygroundPage() {
  const { activeConfig, addDecision, preapprovedEntries } = useConfigStore();
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);
  const [customer, setCustomer] = useState<CustomerRecord>({});

  const fields = activeConfig.customerFields.filter((f) => f.enabled && f.visibleInPlayground);
  const cinetStatusField = fields.find((f) => f.key === 'cinet_status');
  const cinetScoreField = fields.find((f) => f.key === 'cinet_score');
  const cinetRestFields = fields.filter((f) => f.group === 'cinet' && f.key !== 'cinet_status' && f.key !== 'cinet_score');
  const cinetStatus = (customer.cinet_status as CinetStatus) ?? 'NOT_CHECKED';

  const handleFieldChange = (key: string, value: unknown) => {
    setCustomer((prev) => ({ ...prev, [key]: value }));
  };

  const loadSample = (sampleId: string) => {
    const sample = SAMPLE_CUSTOMERS.find((s) => s.id === sampleId);
    if (!sample) return;
    setCustomer({ ...sample.data });
    setStepIdx(0);
    // Samples that simulate a CINET outage set their own CINET-sourced fields to null
    // directly — never mutate the shared Integration Simulator config here, or every
    // later run in the session would be affected too.
  };

  const runEngine = () => {
    const resolved = resolveCustomerRecord(customer, activeConfig);
    const result = runDecisionEngine(activeConfig, resolved, preapprovedEntries);
    addDecision(result);
    navigate(`/result/${result.id}`);
  };

  const current = STEPS[stepIdx];

  const reviewRows = useMemo(
    () => fields.map((f) => ({ field: f, value: customer[f.key] })),
    [fields, customer]
  );

  const residencyPreview = useMemo(
    () => deriveResidencyFields(customer),
    [customer.residency_status, customer.residency_start_date, customer.residency_expiry_date]
  );

  const dtiPreview = useMemo(
    () => computeDebtToIncome(customer),
    [customer.monthly_income, customer.monthly_debt_obligations]
  );

  // Read-only, never user-selectable — derived the same way the engine will derive it,
  // from CINET overdue amount and open-account repayment signals.
  const delinquencyPreview = useMemo(
    () => deriveCurrentDelinquency(customer),
    [customer.total_overdue_bnpl_amount, customer.cinet_open_accounts]
  );

  // Live, read-only preview — never user-selectable. Derived the same way the engine
  // will derive it: from the mock-verified civil ID (never the raw typed one) or mobile.
  const preapprovedPreview = useMemo(() => {
    if (!customer.civil_id && !customer.mobile_number) return null;
    const verifiedCivilId = getVerifiedCivilId(customer);
    return findPreapprovedMatch(verifiedCivilId, customer.mobile_number, preapprovedEntries);
  }, [customer.civil_id, customer.civil_id_status, customer.mobile_number, preapprovedEntries]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Customer Playground</h1>
        <p className="page-subtitle">Walk a synthetic customer through identity, employment, and history capture, then run the decision engine.</p>
      </div>

      <Card title="Sample Customers" desc="Preload a scenario to explore how the engine behaves.">
        <div className="pill-btn-group">
          {SAMPLE_CUSTOMERS.map((s) => (
            <Button key={s.id} size="sm" onClick={() => loadSample(s.id)} title={s.description}>{s.label}</Button>
          ))}
        </div>
      </Card>

      <Card>
        <div className="wizard-steps">
          {STEPS.map((s, idx) => (
            <div
              key={s.key}
              className={`wizard-step${idx === stepIdx ? ' active' : idx < stepIdx ? ' done' : ''}`}
              onClick={() => setStepIdx(idx)}
              style={{ cursor: 'pointer' }}
            >
              {s.label}
            </div>
          ))}
        </div>

        {current.key !== 'review' && (
          <WizardStepFields fields={fields} group={current.key} data={customer} onFieldChange={handleFieldChange} />
        )}

        {current.key === 'employment' && (
          <>
            <div className="divider" />
            <p className="card-title" style={{ marginBottom: 10 }}>CINET Credit Bureau</p>

            {cinetStatusField && (
              <div className="grid grid-2">
                <FieldInput field={cinetStatusField} value={customer.cinet_status} onChange={(v) => handleFieldChange('cinet_status', v)} />
                <div className="field-group">
                  <label className="field-label">CINET Score</label>
                  {cinetStatus === 'AVAILABLE' && cinetScoreField ? (
                    <FieldInput field={cinetScoreField} value={customer.cinet_score} onChange={(v) => handleFieldChange('cinet_score', v)} />
                  ) : (
                    <input type="text" value={CINET_STATUS_LABELS[cinetStatus]} disabled />
                  )}
                  <p className="card-desc" style={{ marginTop: 4 }}>
                    {cinetStatus === 'AVAILABLE'
                      ? 'Included in scoring at its configured weight.'
                      : 'Not checked or unavailable — excluded from scoring, never shown as a fake number, and remaining factors are re-weighted to 100%.'}
                  </p>
                </div>
              </div>
            )}

            <WizardStepFields fields={cinetRestFields} group="cinet" data={customer} onFieldChange={handleFieldChange} />

            <div className="field-group">
              <label className="field-label">Current Delinquency</label>
              <input type="text" value={formatCurrentDelinquency(delinquencyPreview)} disabled />
              <p className="card-desc" style={{ marginTop: 4 }}>Current Delinquency is derived from CINET repayment and overdue data.</p>
            </div>
            <div className="field-group">
              <label className="field-label">Debt-to-Income</label>
              <input type="text" value={formatDtiPercent(dtiPreview)} disabled />
              <p className="card-desc" style={{ marginTop: 4 }}>Calculated from monthly debt obligations ÷ monthly income</p>
            </div>
          </>
        )}

        {current.key === 'identity' && (
          <div className="small-note" style={{ marginTop: 4, marginBottom: 4 }}>
            Preapproved Status: <strong>{preapprovedPreview ? PREAPPROVED_MATCH_LABELS[preapprovedPreview.status] : 'Not Checked'}</strong>
            <span className="muted"> (derived from the mock Preapproved List — not user-selectable)</span>
          </div>
        )}

        {current.key === 'identity' && (
          <p className="card-desc" style={{ marginTop: 4, marginBottom: 4 }}>
            Nationality's role is entirely configuration-driven: it may act as a Hard Gate condition (e.g. Student Nationality,
            or the Kuwaiti Civil ID Status exemption) and/or a scoring factor, depending on the segment's configured Hard
            Gates and Scoring Inputs — never automatic just because the field exists.
          </p>
        )}

        {current.key === 'identity' && Boolean(customer.residency_status || customer.residency_start_date) && (
          <div className="small-note" style={{ marginTop: 4 }}>
            Residency Duration: <strong>{residencyPreview.residency_duration_years ?? '—'}{residencyPreview.residency_duration_years !== null ? ' years' : ''}</strong>
            {' · '}Residency Remaining: <strong>{residencyPreview.residency_remaining_months ?? '—'}{residencyPreview.residency_remaining_months !== null ? ' months' : ''}</strong>
            {' · '}Residency Stability: <strong>{RESIDENCY_STABILITY_LABELS[residencyPreview.residency_stability_category] ?? residencyPreview.residency_stability_category}</strong>
            <span className="muted"> (auto-derived — never from nationality)</span>
          </div>
        )}

        {current.key === 'review' && (
          <div>
            <p className="card-desc" style={{ marginBottom: 12 }}>Review each captured field and its configured source before running the engine. Fields left blank may be filled by an online mock integration, or forced unavailable by one simulated as down.</p>
            <div className="small-note" style={{ marginBottom: 12 }}>
              Preapproved Status: <strong>{preapprovedPreview ? PREAPPROVED_MATCH_LABELS[preapprovedPreview.status] : 'Not Checked'}</strong>
              {' · '}Debt-to-Income: <strong>{formatDtiPercent(dtiPreview)}</strong>
              {' · '}Current Delinquency: <strong>{formatCurrentDelinquency(delinquencyPreview)}</strong>
              {' · '}CINET: <strong>{CINET_STATUS_LABELS[cinetStatus]}</strong>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Field</th><th>Value</th><th>Source</th><th>Group</th></tr>
                </thead>
                <tbody>
                  {reviewRows.map(({ field, value }) => (
                    <tr key={field.key}>
                      <td>{field.displayName}</td>
                      <td>
                        {field.key === 'civil_id'
                          ? maskCivilId(value as string)
                          : field.type === 'date'
                          ? formatDate(value as string)
                          : value === null || value === undefined || value === ''
                          ? <span className="muted">— empty —</span>
                          : field.optionLabels?.[value as string] ?? String(value)}
                      </td>
                      <td>{field.source}</td>
                      <td className="muted">{field.group}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="wizard-actions">
          <Button onClick={() => setStepIdx((i) => Math.max(0, i - 1))} disabled={stepIdx === 0}>← Back</Button>
          {stepIdx < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))}>Next →</Button>
          ) : (
            <Button variant="primary" onClick={runEngine}>RUN DECISION ENGINE</Button>
          )}
        </div>
      </Card>
    </div>
  );
}
