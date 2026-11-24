export interface StackedBarSegment { label: string; value: number; color: string; }

/** A single horizontal bar split proportionally across named segments (e.g. Approved /
 *  Manual Review / Rejected within one customer Segment) — used where a plain BarList's
 *  single-color bar can't show a composition, only a total. */
export function StackedBarRow({ label, segments, total }: { label: string; segments: StackedBarSegment[]; total: number }) {
  const max = Math.max(1, total);
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="flex-between" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span className="muted" style={{ fontSize: 12 }}>{total} total</span>
      </div>
      <div style={{ display: 'flex', height: 14, borderRadius: 6, overflow: 'hidden', background: 'var(--border-soft)' }}>
        {segments.map((s) => (
          s.value > 0 && (
            <div
              key={s.label}
              title={`${s.label}: ${s.value}`}
              style={{ width: `${(s.value / max) * 100}%`, background: s.color, minWidth: s.value > 0 ? 3 : 0 }}
            />
          )
        ))}
      </div>
      <div className="flex-row" style={{ marginTop: 4, gap: 12, flexWrap: 'wrap' }}>
        {segments.map((s) => (
          <span key={s.label} style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 4, verticalAlign: 'middle' }} />
            {s.label}: {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}
