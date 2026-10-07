import { useMemo, useRef, useState } from 'react';

function niceStep(max) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/**
 * Colonnes groupées (une seule échelle). series = [{ key, label, color }], rows = [{ label, tip, [key]: value }]
 */
export function ColumnChart({ rows, series, height = 240, format = (v) => v, tickFormat = format }) {
  const wrap = useRef();
  const [hover, setHover] = useState(null);
  const W = 720;
  const padL = 56;
  const padR = 8;
  const padT = 10;
  const padB = 28;
  const { min, max, step } = useMemo(() => {
    const vals = rows.flatMap((r) => series.map((s) => r[s.key] || 0));
    const hi = Math.max(0, ...vals);
    const lo = Math.min(0, ...vals);
    const st = niceStep(Math.max(hi - lo, 1));
    return { min: Math.floor(lo / st) * st, max: Math.ceil(hi / st) * st || st, step: st };
  }, [rows, series]);
  const plotH = height - padT - padB;
  const y = (v) => padT + ((max - v) / (max - min)) * plotH;
  const band = (W - padL - padR) / Math.max(rows.length, 1);
  const gap = 2;
  const barW = Math.min(24, Math.max(3, (band * 0.72 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const ticks = [];
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(v);
  const labelEvery = Math.ceil(rows.length / 12);

  const bar = (x, v, color) => {
    const y0 = y(0);
    const y1 = y(v);
    const h = Math.abs(y0 - y1);
    if (h < 0.5) return null;
    const r = Math.min(4, h, barW / 2);
    const top = Math.min(y0, y1);
    // extrémité arrondie côté donnée, carrée côté ligne de base
    const d = v >= 0
      ? `M${x},${y0} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${y0} Z`
      : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 - r} V${y0} Z`;
    return <path d={d} fill={color} />;
  };

  return (
    <div className="chart" ref={wrap}>
      <div className="chart__legend">
        {series.map((s) => <span key={s.key} className="chart__key"><span className="chart__swatch" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={series.map((s) => s.label).join(' et ')} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#c9d3da' : '#eef2f4'} strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#687884">{tickFormat(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x0 = padL + band * i + (band - groupW) / 2;
          return (
            <g key={r.label + i}>
              {hover === i && <rect x={padL + band * i} y={padT} width={band} height={plotH} fill="#f0f3f5" />}
              {series.map((s, j) => <g key={s.key}>{bar(x0 + j * (barW + gap), r[s.key] || 0, s.color)}</g>)}
              {i % labelEvery === 0 && <text x={padL + band * i + band / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="#687884">{r.label}</text>}
              <rect x={padL + band * i} y={padT} width={band} height={plotH} fill="transparent"
                onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover != null && rows[hover] && (
        <div className="chart__tip" style={{ left: `${((padL + band * hover + band / 2) / W) * 100}%`, top: `${(padT / height) * 100}%` }}>
          <div className="strong">{rows[hover].tip || rows[hover].label}</div>
          {series.map((s) => (
            <div key={s.key} className="chart__tip-row"><span className="chart__swatch" style={{ background: s.color }} />{s.label} : {format(rows[hover][s.key] || 0)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
