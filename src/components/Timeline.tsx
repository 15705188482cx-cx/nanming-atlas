'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EVENTS } from '@/lib/data';
import { Y0, Y1, clampYear, decimalYear, eventDistance, reignLabel } from '@/lib/time';
import { REGIMES } from '@/lib/types';
import { useAtlas } from '@/store';

const H = 128;
const AXIS_Y = 100;
const LANES: Record<string, number> = { military: 42, political: 64, other: 86 };
const N_MING_ERAS = [
  { from: 1573, to: 1620, label: '万历' },
  { from: 1620, to: 1627, label: '天启' },
  { from: 1627, to: 1644, label: '崇祯' },
];
const N_NANMING_ERAS = [
  { from: 1644, to: 1645, label: '弘光' },
  { from: 1645, to: 1646, label: '隆武' },
  { from: 1646, to: 1661, label: '永历' },
  { from: 1661, to: 1667, label: '康熙' },
];

function laneOf(cat: string): number {
  return LANES[cat] ?? LANES.other;
}

export default function Timeline() {
  const year = useAtlas((s) => s.year);
  const playing = useAtlas((s) => s.playing);
  const speed = useAtlas((s) => s.speed);
  const win = useAtlas((s) => s.windowYears);
  const selectedId = useAtlas((s) => s.selectedId);
  const regimeFilter = useAtlas((s) => s.regimeFilter);
  const categoryFilter = useAtlas((s) => s.categoryFilter);
  const setYear = useAtlas((s) => s.setYear);
  const setPlaying = useAtlas((s) => s.setPlaying);
  const setSpeed = useAtlas((s) => s.setSpeed);
  const setWindow = useAtlas((s) => s.setWindow);
  const select = useAtlas((s) => s.select);

  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(1200);
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const x = (decYear: number) => ((decYear - Y0) / (Y1 - Y0)) * width;

  const dots = useMemo(
    () =>
      EVENTS.filter(
        (e) => regimeFilter[e.regime] !== false && categoryFilter[e.category] !== false,
      ).map((e) => {
        const dist = win === 0 ? 0 : eventDistance(e, year);
        return {
          ev: e,
          cx: x(decimalYear(e.date)),
          cy: laneOf(e.category),
          r: e.importance === 3 ? 5 : e.importance === 2 ? 3.6 : 2.6,
          color: REGIMES[e.regime].color,
          dim: dist > win,
          selected: e.id === selectedId,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [EVENTS, regimeFilter, categoryFilter, year, win, selectedId, width],
  );

  const seek = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (clientX - rect.left) / rect.width;
    setYear(clampYear(Y0 + frac * (Y1 - Y0)));
  };

  return (
    <section className="tl" aria-label="时间轴">
      <div className="tl-controls">
        <div className="tl-year">
          <strong>{Math.floor(year)}</strong>
          <span>{reignLabel(year)}</span>
        </div>
        <button className="tl-play" onClick={() => setPlaying(!playing)} aria-label={playing ? '暂停' : '播放'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="tl-right">
          <label>
            速度
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={1.5}>慢</option>
              <option value={3}>中</option>
              <option value={6}>快</option>
            </select>
          </label>
          <label>
            视野
            <select value={win} onChange={(e) => setWindow(Number(e.target.value))}>
              <option value={1}>±1 年</option>
              <option value={2}>±2 年</option>
              <option value={5}>±5 年</option>
              <option value={0}>全部</option>
            </select>
          </label>
        </div>
      </div>

      <svg
        ref={svgRef}
        className="tl-svg"
        viewBox={`0 0 ${width} ${H}`}
        preserveAspectRatio="none"
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(e.clientX);
        }}
        onPointerMove={(e) => draggingRef.current && seek(e.clientX)}
        onPointerUp={() => (draggingRef.current = false)}
      >
        {/* 时代带 */}
        {N_MING_ERAS.map((era) => (
          <g key={era.label}>
            <rect
              x={x(Math.max(era.from, Y0))}
              y={8}
              width={Math.max(0, x(Math.min(era.to, Y1)) - x(Math.max(era.from, Y0)))}
              height={16}
              fill="rgba(255,255,255,0.04)"
            />
            {x(Math.min(era.to, Y1)) - x(Math.max(era.from, Y0)) > 26 && (
              <text
                x={(x(Math.max(era.from, Y0)) + x(Math.min(era.to, Y1))) / 2}
                y={19}
                textAnchor="middle"
                fontSize="10"
                fill="rgba(232,230,223,0.55)"
              >
                {era.label}
              </text>
            )}
          </g>
        ))}
        <rect x={x(1644)} y={8} width={x(1661) - x(1644)} height={16} fill="rgba(242,201,76,0.10)" />
        {N_NANMING_ERAS.map((era) =>
          x(Math.min(era.to, Y1)) - x(Math.max(era.from, Y0)) > 26 ? (
            <text
              key={era.label}
              x={(x(Math.max(era.from, Y0)) + x(Math.min(era.to, Y1))) / 2}
              y={19}
              textAnchor="middle"
              fontSize="10"
              fill="rgba(242,201,76,0.75)"
            >
              {era.label}
            </text>
          ) : null,
        )}

        {/* 十年刻度 */}
        <line x1={0} y1={AXIS_Y} x2={width} y2={AXIS_Y} stroke="rgba(255,255,255,0.16)" />
        {Array.from({ length: (Y1 - Y0) / 10 + 1 }, (_, i) => {
          const yr = Y0 + i * 10;
          return (
            <g key={yr}>
              <line x1={x(yr)} y1={AXIS_Y} x2={x(yr)} y2={AXIS_Y + 5} stroke="rgba(255,255,255,0.3)" />
              <text x={x(yr) + 4} y={AXIS_Y + 16} fontSize="10" fill="rgba(232,230,223,0.45)">
                {yr}
              </text>
            </g>
          );
        })}

        {/* 跨期事件的连线 */}
        {dots
          .filter((d) => d.ev.endDate)
          .map((d) => (
            <line
              key={`span-${d.ev.id}`}
              x1={d.cx}
              y1={d.cy}
              x2={x(decimalYear(d.ev.endDate!))}
              y2={d.cy}
              stroke={d.color}
              strokeWidth={1.6}
              opacity={d.dim ? 0.12 : 0.5}
            />
          ))}

        {/* 事件点 */}
        {dots.map((d) => (
          <circle
            key={d.ev.id}
            cx={d.cx}
            cy={d.cy}
            r={d.selected ? d.r + 2 : d.r}
            fill={d.color}
            opacity={d.dim ? 0.12 : 0.95}
            stroke={d.selected ? '#fff' : 'none'}
            strokeWidth={1.4}
            style={{ cursor: 'pointer' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              select(d.ev.id);
            }}
          >
            <title>{`${d.ev.title} · ${d.ev.date}`}</title>
          </circle>
        ))}

        {/* 播放头 */}
        <g pointerEvents="none">
          <line x1={x(year)} y1={24} x2={x(year)} y2={AXIS_Y} stroke="#f2c94c" strokeWidth={1.4} />
          <path d={`M ${x(year)} ${AXIS_Y} l -5 8 l 10 0 z`} fill="#f2c94c" />
        </g>
      </svg>
    </section>
  );
}
