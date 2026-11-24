import { useConfigStore } from '../hooks/ConfigContext';
import { Card, Button } from '../components/ui';
import type { IntegrationState } from '../models/configuration';
import type { CinetOpenAccount } from '../models/cinet';

const STATES: IntegrationState[] = ['ONLINE', 'TIMEOUT', 'ERROR'];

function stateDot(state: IntegrationState) {
  if (state === 'ONLINE') return 'dot-green';
  if (state === 'TIMEOUT') return 'dot-amber';
  return 'dot-red';
}

const EMPTY_ACCOUNT: CinetOpenAccount = { accountNo: '', accountStatus: 'CURRENT', paymentsOutstanding: 0, outstandingBalance: 0, overdueBalance: 0, dpd: 0 };

export default function IntegrationsPage() {
  const { activeConfig, updateActiveConfig } = useConfigStore();

  const setState = (id: string, state: IntegrationState) => {
    updateActiveConfig((cfg) => ({ ...cfg, integrations: cfg.integrations.map((i) => (i.id === id ? { ...i, state } : i)) }));
  };

  const setMockValue = (id: string, field: string, value: unknown) => {
    updateActiveConfig((cfg) => ({
      ...cfg,
      integrations: cfg.integrations.map((i) => (i.id === id ? { ...i, mockData: { ...i.mockData, [field]: value } } : i)),
    }));
  };

  const cinetOpenAccounts = (activeConfig.integrations.find((i) => i.id === 'cinet')?.mockData.cinet_open_accounts as CinetOpenAccount[] | null) ?? [];

  const patchAccount = (idx: number, patch: Partial<CinetOpenAccount>) => {
    const next = cinetOpenAccounts.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    setMockValue('cinet', 'cinet_open_accounts', next);
  };
  const addAccount = () => setMockValue('cinet', 'cinet_open_accounts', [...cinetOpenAccounts, { ...EMPTY_ACCOUNT, accountNo: `DEMO-${cinetOpenAccounts.length + 1}` }]);
  const removeAccount = (idx: number) => setMockValue('cinet', 'cinet_open_accounts', cinetOpenAccounts.filter((_, i) => i !== idx));

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Integration Simulator</h1>
        <p className="page-subtitle">Simulate what each external system returns. When an integration is TIMEOUT or ERROR, its fields become unavailable to the decision engine regardless of wizard input.</p>
      </div>

      <div className="grid grid-2">
        {activeConfig.integrations.map((integration) => (
          <Card
            key={integration.id}
            title={integration.name}
            actions={
              <span className="flex-row">
                <span className={`dot ${stateDot(integration.state)}`} />
                <select value={integration.state} onChange={(e) => setState(integration.id, e.target.value as IntegrationState)}>
                  {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </span>
            }
          >
            <p className="card-desc" style={{ marginBottom: 10 }}>Fields supplied: {integration.fields.filter((f) => f !== 'cinet_open_accounts').join(', ')}</p>
            <div className="stack-sm">
              {integration.fields.filter((field) => field !== 'cinet_open_accounts').map((field) => {
                const catalogField = activeConfig.customerFields.find((f) => f.key === field);
                const value = integration.mockData[field];
                return (
                  <div key={field} className="flex-row">
                    <span className="mono muted" style={{ width: 220, flexShrink: 0 }}>{catalogField?.displayName ?? field}</span>
                    {catalogField?.type === 'boolean' ? (
                      <select value={String(value)} onChange={(e) => setMockValue(integration.id, field, e.target.value === 'true')}>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : catalogField?.type === 'enum' && catalogField.options ? (
                      <select value={String(value ?? '')} onChange={(e) => setMockValue(integration.id, field, e.target.value)}>
                        {catalogField.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={catalogField?.type === 'number' ? 'number' : catalogField?.type === 'date' ? 'date' : 'text'}
                        value={value === null || value === undefined ? '' : String(value)}
                        onChange={(e) => setMockValue(integration.id, field, catalogField?.type === 'number' ? Number(e.target.value) : e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {integration.id === 'cinet' && (
              <div style={{ marginTop: 16 }}>
                <div className="flex-between" style={{ marginBottom: 8 }}>
                  <p className="card-desc" style={{ margin: 0 }}>
                    Open Accounts (technical detail) — conceptually ACCOUNTSTATUS / NOOFPAYMENTSOUTSTANDING / OUTSTANDINGBALANCE / OVERDUEBALANCE / DPD. Drives the Current Delinquency derivation; never shown in the normal Customer Playground.
                  </p>
                  <Button size="sm" onClick={addAccount}>+ Add Account</Button>
                </div>
                {cinetOpenAccounts.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12.5 }}>No open accounts configured (or CINET is simulated as down).</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr><th>Account No</th><th>Status</th><th>Payments Outstanding</th><th>Outstanding Balance</th><th>Overdue Balance</th><th>DPD</th><th></th></tr>
                      </thead>
                      <tbody>
                        {cinetOpenAccounts.map((acct, idx) => (
                          <tr key={idx}>
                            <td><input type="text" className="mono" style={{ width: 100 }} value={acct.accountNo} onChange={(e) => patchAccount(idx, { accountNo: e.target.value })} /></td>
                            <td>
                              <select style={{ minWidth: 150 }} value={acct.accountStatus} onChange={(e) => patchAccount(idx, { accountStatus: e.target.value })}>
                                <option value="CURRENT">CURRENT</option>
                                <option value="DELINQUENT">DELINQUENT</option>
                                <option value="SERIOUS_DELINQUENCY">SERIOUS_DELINQUENCY</option>
                                <option value="UNKNOWN">UNKNOWN</option>
                              </select>
                            </td>
                            <td><input type="number" style={{ width: 80 }} value={acct.paymentsOutstanding ?? ''} onChange={(e) => patchAccount(idx, { paymentsOutstanding: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                            <td><input type="number" style={{ width: 90 }} value={acct.outstandingBalance ?? ''} onChange={(e) => patchAccount(idx, { outstandingBalance: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                            <td><input type="number" style={{ width: 90 }} value={acct.overdueBalance ?? ''} onChange={(e) => patchAccount(idx, { overdueBalance: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                            <td><input type="number" style={{ width: 70 }} value={acct.dpd ?? ''} onChange={(e) => patchAccount(idx, { dpd: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                            <td><Button size="sm" variant="danger" onClick={() => removeAccount(idx)}>×</Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
