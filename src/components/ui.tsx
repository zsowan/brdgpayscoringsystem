import type { DecisionOutcome, ConfigStatus } from '../models/configuration';

export function Card({ title, desc, actions, children }: { title?: string; desc?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <p className="card-title">{title}</p>}
            {desc && <p className="card-desc">{desc}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function DecisionBadge({ outcome }: { outcome: DecisionOutcome }) {
  const map: Record<DecisionOutcome, { cls: string; dot: string; label: string }> = {
    APPROVE: { cls: 'badge-approve', dot: 'dot-green', label: 'Approve' },
    MANUAL_REVIEW: { cls: 'badge-review', dot: 'dot-amber', label: 'Manual Review' },
    REJECT: { cls: 'badge-reject', dot: 'dot-red', label: 'Reject' },
  };
  const m = map[outcome];
  return (
    <span className={`badge ${m.cls}`}>
      <span className={`dot ${m.dot}`} />
      {m.label}
    </span>
  );
}

export function ConfigStatusBadge({ status }: { status: ConfigStatus }) {
  const map: Record<ConfigStatus, string> = {
    DRAFT: 'badge-draft',
    IN_REVIEW: 'badge-review-status',
    ACTIVE: 'badge-active',
    RETIRED: 'badge-retired',
  };
  return <span className={`badge ${map[status]}`}>{status.replace('_', ' ')}</span>;
}

export function Button({
  children, onClick, variant = 'default', size = 'md', disabled, type = 'button', className = '', title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger';
  size?: 'md' | 'sm';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  const variantCls = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : '';
  const sizeCls = size === 'sm' ? 'btn-sm' : '';
  return (
    <button type={type} className={`btn ${variantCls} ${sizeCls} ${className}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi-tile">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Field({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      {children}
      {note && <p className="card-desc" style={{ marginTop: 4 }}>{note}</p>}
    </div>
  );
}
