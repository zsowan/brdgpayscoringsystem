import type { DecisionBandDef } from '../models/configuration';

const OUTCOME_COLOR: Record<string, string> = {
  REJECT: '#d99490',
  MANUAL_REVIEW: '#f0c27b',
};

const TIER_COLOR = ['#a9c4f5', '#6f9bea', '#2054c9'];

function colorFor(band: DecisionBandDef, tierIndex: number): string {
  if (band.outcome === 'APPROVE') return TIER_COLOR[Math.min(tierIndex, TIER_COLOR.length - 1)];
  return OUTCOME_COLOR[band.outcome] ?? '#ccc';
}

export function ScoreBar({ bands, score }: { bands: DecisionBandDef[]; score: number }) {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  let tierIndex = 0;
  const segs = sorted.map((b) => {
    const idx = b.outcome === 'APPROVE' ? tierIndex++ : -1;
    return { band: b, color: colorFor(b, idx) };
  });
  const pct = Math.max(0, Math.min(100, score * 100));

  return (
    <div className="score-bar-wrap">
      <div className="score-bar-marker" style={{ left: `${pct}%` }}>
        <span className="score-bar-marker-value">{pct.toFixed(1)}</span>
        <span className="score-bar-marker-line" />
      </div>
      <div className="score-bar-track">
        {segs.map(({ band, color }) => (
          <div
            key={band.id}
            className="score-bar-seg"
            style={{ width: `${(Math.min(1, band.max) - band.min) * 100}%`, background: color }}
            title={`${band.outcome}${band.tier ? ' · ' + band.tier : ''} [${(band.min * 100).toFixed(0)}–${(Math.min(1, band.max) * 100).toFixed(0)}]`}
          />
        ))}
      </div>
      <div className="score-bar-labels">
        {sorted.map((b) => (
          <span key={b.id}>{b.tier ?? b.outcome.replace('_', ' ')}</span>
        ))}
      </div>
    </div>
  );
}
