/** Lightweight SVG charts tuned for small screens. No dependencies. */
import { useState } from 'react';

export interface BarDatum {
  label: string;
  value: number;
  planned?: number;
  highlight?: boolean;
  projected?: boolean;
}

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * p;
}

export function BarChart({
  data,
  height = 180,
  color = '#3ee0a1',
  unit = 'km',
  goal,
  format = (v: number) => v.toLocaleString('nb-NO', { maximumFractionDigits: 1 }),
  labelEvery,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  unit?: string;
  goal?: number;
  format?: (v: number) => string;
  labelEvery?: number;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const W = 340;
  const H = height;
  const padL = 30;
  const padB = 22;
  const padT = 10;
  const max = niceMax(Math.max(goal ?? 0, ...data.map((d) => Math.max(d.value, d.planned ?? 0))));
  const n = Math.max(1, data.length);
  const slot = (W - padL) / n;
  const bw = Math.max(3, Math.min(26, slot * 0.62));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const every = labelEvery ?? Math.ceil(n / 7);
  const ticks = [0, max / 2, max];
  const s = sel !== null ? data[sel] : null;

  return (
    <div>
      <div className="mb-2 h-5 text-[13px] text-muted">
        {s ? (
          <span>
            <span className="text-ink">{s.label}</span> · {format(s.value)} {unit}
            {s.planned !== undefined && <span> av {format(s.planned)} planlagt</span>}
            {s.projected && <span> (foreløpig)</span>}
          </span>
        ) : (
          <span className="text-dim">Trykk på en søyle for detaljer</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} onMouseLeave={() => setSel(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="#262b33" strokeWidth={1} strokeDasharray={t === 0 ? '' : '2 4'} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#5d6573" className="num">
              {format(t)}
            </text>
          </g>
        ))}
        {goal !== undefined && goal > 0 && (
          <g>
            <line x1={padL} x2={W} y1={y(goal)} y2={y(goal)} stroke="#7aa8ff" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
          </g>
        )}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const active = sel === i;
          return (
            <g key={i} onClick={() => setSel(active ? null : i)} style={{ cursor: 'pointer' }}>
              <rect x={padL + slot * i} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
              {d.planned !== undefined && d.planned > 0 && (
                <rect
                  x={cx - bw / 2}
                  y={y(d.planned)}
                  width={bw}
                  height={Math.max(0, y(0) - y(d.planned))}
                  rx={Math.min(5, bw / 3)}
                  fill="none"
                  stroke="#5d6573"
                  strokeWidth={1.2}
                  strokeDasharray="3 2"
                />
              )}
              {d.value > 0 && (
                <rect
                  x={cx - bw / 2}
                  y={y(d.value)}
                  width={bw}
                  height={Math.max(0, y(0) - y(d.value))}
                  rx={Math.min(5, bw / 3)}
                  fill={color}
                  opacity={d.projected ? 0.25 : active || sel === null ? (d.highlight ? 1 : 0.85) : 0.4}
                />
              )}
              {(i % every === 0 || i === n - 1) && (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill={active ? '#eef1f5' : '#5d6573'}>
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface LinePoint {
  label: string;
  value?: number;
  value2?: number;
}

export function LineChart({
  data,
  height = 170,
  color = '#3ee0a1',
  color2 = '#ff8a7a',
  format = (v: number) => String(Math.round(v)),
  format2 = (v: number) => String(Math.round(v)),
  invert = false,
  name = '',
  name2 = '',
}: {
  data: LinePoint[];
  height?: number;
  color?: string;
  color2?: string;
  format?: (v: number) => string;
  format2?: (v: number) => string;
  invert?: boolean; // lower is better (e.g. pace) → plot inverted
  name?: string;
  name2?: string;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const W = 340;
  const H = height;
  const padL = 36;
  const padR = 36;
  const padT = 10;
  const padB = 22;
  const vals = data.map((d) => d.value).filter((v): v is number => v !== undefined);
  const vals2 = data.map((d) => d.value2).filter((v): v is number => v !== undefined);
  if (!vals.length) {
    return <div className="flex h-[120px] items-center justify-center text-[14px] text-dim">Ikke nok data ennå</div>;
  }
  const range = (xs: number[]) => {
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const pad = (hi - lo) * 0.15 || Math.max(1, Math.abs(hi) * 0.05);
    return [lo - pad, hi + pad];
  };
  const [lo, hi] = range(vals);
  const [lo2, hi2] = vals2.length ? range(vals2) : [0, 1];
  const n = data.length;
  const x = (i: number) => padL + ((W - padL - padR) * (n === 1 ? 0.5 : i / (n - 1)));
  const yv = (v: number) => {
    const t = (v - lo) / (hi - lo);
    return padT + (H - padT - padB) * (invert ? t : 1 - t);
  };
  const y2 = (v: number) => padT + (H - padT - padB) * (1 - (v - lo2) / (hi2 - lo2));
  const path = (pts: [number, number][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const p1 = data.map((d, i) => (d.value !== undefined ? ([x(i), yv(d.value)] as [number, number]) : null)).filter(Boolean) as [number, number][];
  const p2 = data.map((d, i) => (d.value2 !== undefined ? ([x(i), y2(d.value2)] as [number, number]) : null)).filter(Boolean) as [number, number][];
  const every = Math.ceil(n / 6);
  const s = sel !== null ? data[sel] : null;

  return (
    <div>
      <div className="mb-2 flex h-5 items-center gap-3 text-[13px] text-muted">
        {s ? (
          <>
            <span className="text-ink">{s.label}</span>
            {s.value !== undefined && (
              <span>
                <span style={{ color }}>●</span> {name} {format(s.value)}
              </span>
            )}
            {s.value2 !== undefined && (
              <span>
                <span style={{ color: color2 }}>●</span> {name2} {format2(s.value2)}
              </span>
            )}
          </>
        ) : (
          <>
            <span>
              <span style={{ color }}>●</span> {name}
            </span>
            {vals2.length > 0 && (
              <span>
                <span style={{ color: color2 }}>●</span> {name2}
              </span>
            )}
          </>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        {[lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1].map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yv(t)} y2={yv(t)} stroke="#262b33" strokeDasharray="2 4" />
            <text x={padL - 6} y={yv(t) + 4} textAnchor="end" fontSize={10} fill={color} opacity={0.7} className="num">
              {format(t)}
            </text>
          </g>
        ))}
        {vals2.length > 0 &&
          [lo2 + (hi2 - lo2) * 0.1, hi2 - (hi2 - lo2) * 0.1].map((t, i) => (
            <text key={i} x={W - padR + 6} y={y2(t) + 4} fontSize={10} fill={color2} opacity={0.7} className="num">
              {format2(t)}
            </text>
          ))}
        {p2.length > 1 && <path d={path(p2)} fill="none" stroke={color2} strokeWidth={1.8} opacity={0.8} strokeLinejoin="round" />}
        {p1.length > 1 && <path d={path(p1)} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />}
        {data.map((d, i) => (
          <g key={i} onClick={() => setSel(sel === i ? null : i)}>
            <rect x={x(i) - (W / n) / 2} y={0} width={W / n} height={H} fill="transparent" />
            {d.value !== undefined && <circle cx={x(i)} cy={yv(d.value)} r={sel === i ? 4.5 : 2.6} fill={color} />}
            {d.value2 !== undefined && <circle cx={x(i)} cy={y2(d.value2)} r={sel === i ? 4 : 2.2} fill={color2} />}
            {(i % every === 0 || i === n - 1) && (
              <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="#5d6573">
                {d.label}
              </text>
            )}
          </g>
        ))}
        {sel !== null && <line x1={x(sel)} x2={x(sel)} y1={padT} y2={H - padB} stroke="#eef1f5" opacity={0.2} />}
      </svg>
    </div>
  );
}
