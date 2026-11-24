
export interface BarListItem {
  label: string;
  value: number;
  color?: string;
}

const DEFAULT_COLOR = '#2a78d6';

export function BarList({ items, unit }: { items: BarListItem[]; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));

  if (items.length === 0) {
    return <p className="muted" style={{ fontSize: 12.5 }}>No data yet.</p>;
  }

  return (
    <div className="stack-sm" role="table" aria-label="bar chart">
      {items.map((item) => (
        <div key={item.label} role="row" style={{ display: 'grid', gridTemplateColumns: '150px 1fr 46px', alignItems: 'center', gap: 10 }}>
          <span
            role="cell"
            style={{ fontSize: 12.5, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={item.label}
          >{item.label}</span>
          <div role="cell" style={{ background: 'var(--border-soft)', borderRadius: 6, height: 14, position: 'relative', overflow: 'hidden' }}>
            <div
              style={{
                width: `${(item.value / max) * 100}%`,
                background: item.color ?? DEFAULT_COLOR,
                height: '100%',
                borderRadius: 6,
                minWidth: item.value > 0 ? 4 : 0,
                transition: 'width 0.2s ease',
              }}
            />
          </div>
          <span role="cell" className="mono" style={{ fontSize: 12, textAlign: 'right', color: 'var(--ink-soft)' }}>{item.value}{unit ?? ''}</span>
        </div>
      ))}
    </div>
  );
}
