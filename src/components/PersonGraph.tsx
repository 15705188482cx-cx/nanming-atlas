'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PERSON_BY_NAME } from '@/lib/data';
import { fmtDate } from '@/lib/time';
import { REGIMES } from '@/lib/types';
import { GRAPH_NODES, RELATIONS, REL_COLORS, eventsOfPerson } from '@/lib/graph';
import { useAtlas } from '@/store';

/**
 * 人物图谱(手写力导向,零新依赖):
 * 点阵斥力 + 边弹簧 + 向心,跑 ~5s 静置;节点可拖拽,滚轮缩放,空白拖动平移;
 * 点人物 → 显示生平与其相关事件(可跳事件卡);EventCard 人物 chips 反向打开本面板。
 */
const W = 460;
const H = 560;
const TICK_MS = 16;
const DECAY = 0.994;

type GraphNodeShape = (typeof GRAPH_NODES)[number];

interface SimNode extends GraphNodeShape {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
}

export default function PersonGraph() {
  const focusPerson = useAtlas((s) => s.focusPerson);
  const graphOpen = useAtlas((s) => s.graphOpen);
  const toggleGraph = useAtlas((s) => s.toggleGraph);
  const openGraph = useAtlas((s) => s.openGraph);
  const select = useAtlas((s) => s.select);

  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [tf, setTf] = useState({ k: 1, tx: 0, ty: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const rafRef = useRef(0);
  const alphaRef = useRef(1);
  const dragRef = useRef<{ name: string; offx: number; offy: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const edges = useMemo(
    () =>
      RELATIONS.map((r) => ({
        ...r,
        ai: GRAPH_NODES.findIndex((n) => n.name === r.a),
        bi: GRAPH_NODES.findIndex((n) => n.name === r.b),
      })),
    [],
  );

  // 初始化点阵:按阵营分瓣的圆环布局,再交给力导向舒展
  useEffect(() => {
    if (!graphOpen || nodes.length) return;
    const factions = [...new Set(GRAPH_NODES.map((n) => n.faction))];
    const seeded = GRAPH_NODES.map((n, i) => {
      const fi = factions.indexOf(n.faction);
      const angle = (fi / factions.length) * Math.PI * 2 + i * 0.35;
      const r = 120 + (i % 5) * 28;
      return { ...n, x: W / 2 + Math.cos(angle) * r, y: H / 2 + Math.sin(angle) * r, vx: 0, vy: 0, fx: null, fy: null };
    });
    alphaRef.current = 1;
    setNodes(seeded);
    nodesRef.current = seeded;
  }, [graphOpen, nodes.length]);

  // 力导向迭代(静置后停帧;聚焦变化时重新加热)
  useEffect(() => {
    if (!graphOpen || !nodes.length) return;
    alphaRef.current = 1;
    let stop = false;
    const step = () => {
      if (stop) return;
      const ns = nodesRef.current;
      const alpha = alphaRef.current;
      if (alpha > 0.02) {
        // 点对斥力
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const a = ns[i], b = ns[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) {
              // 重合时给确定性抖动(力导向初值,非安全用途)
              dx = ((i * 37 + j * 17) % 11 - 5) * 0.1;
              dy = ((i * 23 + j * 29) % 11 - 5) * 0.1;
              d2 = 1;
            }
            const d = Math.sqrt(d2);
            const f = (1600 / d2) * alpha;
            const fx = (dx / d) * f, fy = (dy / d) * f;
            a.vx -= fx; a.vy -= fy;
            b.vx += fx; b.vy += fy;
          }
        }
        // 边弹簧
        for (const e of edges) {
          const a = ns[e.ai], b = ns[e.bi];
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          const f = (d - 78) * 0.02 * alpha;
          a.vx += (dx / d) * f; a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
        }
        // 向心 + 阻尼 + 积分
        for (const n of ns) {
          n.vx += (W / 2 - n.x) * 0.004 * alpha;
          n.vy += (H / 2 - n.y) * 0.006 * alpha;
          n.vx *= 0.82; n.vy *= 0.82;
          if (n.fx === null) n.x += n.vx;
          else n.x = n.fx;
          if (n.fy === null) n.y += n.vy;
          else n.y = n.fy;
          n.x = Math.max(24, Math.min(W - 24, n.x));
          n.y = Math.max(24, Math.min(H - 24, n.y));
        }
        alphaRef.current = alpha * DECAY;
      }
      setNodes([...ns]);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      stop = true;
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphOpen, nodes.length]);

  // 指针交互:节点拖拽 / 空白平移
  const toLocal = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  };
  const onPointerDownNode = (e: React.PointerEvent, name: string) => {
    e.stopPropagation();
    const p = toLocal(e);
    const n = nodesRef.current.find((x) => x.name === name)!;
    dragRef.current = { name, offx: n.x - p.x, offy: n.y - p.y };
    alphaRef.current = Math.max(alphaRef.current, 0.3);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current) {
      const p = toLocal(e);
      const n = nodesRef.current.find((x) => x.name === dragRef.current!.name)!;
      n.fx = p.x + dragRef.current.offx;
      n.fy = p.y + dragRef.current.offy;
      n.x = n.fx; n.y = n.fy;
      setNodes([...nodesRef.current]);
    } else if (panRef.current) {
      const dx = (e.clientX - panRef.current.x) / tf.k;
      const dy = (e.clientY - panRef.current.y) / tf.k;
      setTf((t) => ({ ...t, tx: panRef.current!.tx + dx, ty: panRef.current!.ty + dy }));
    }
  };
  const onPointerUp = () => {
    if (dragRef.current) {
      const n = nodesRef.current.find((x) => x.name === dragRef.current!.name)!;
      n.fx = null; n.fy = null;
      dragRef.current = null;
    }
    panRef.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setTf((t) => ({ ...t, k: Math.min(2.6, Math.max(0.55, t.k * (e.deltaY < 0 ? 1.12 : 0.9))) }));
  };

  const person = focusPerson ? PERSON_BY_NAME.get(focusPerson) : null;
  const personEvents = focusPerson ? eventsOfPerson(focusPerson) : [];
  const focusEdges = focusPerson ? edges.filter((e) => e.a === focusPerson || e.b === focusPerson) : [];

  return (
    <aside className="card graph" aria-label="人物图谱">
      <button className="card-close" onClick={toggleGraph} aria-label="关闭图谱">
        ✕
      </button>
      <div className="graph-head">
        <h2>人物图谱</h2>
        <span className="graph-sub">{RELATIONS.length} 条关系 · {GRAPH_NODES.length} 人 · 拖拽/滚轮/点选</span>
      </div>
      <div className="graph-legend">
        {Object.entries(REL_COLORS).map(([t, c]) => (
          <span key={t} className="blegend">
            <i style={{ background: c }} />
            {t}
          </span>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="graph-svg"
        viewBox={`0 0 ${W} ${H}`}
        onWheel={onWheel}
        onPointerDown={(e) => {
          panRef.current = { x: e.clientX, y: e.clientY, tx: tf.tx, ty: tf.ty };
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <g transform={`translate(${W / 2},${H / 2}) scale(${tf.k}) translate(${-W / 2 + tf.tx},${-H / 2 + tf.ty})`}>
          {edges.map((e, i) => {
            const a = nodes[e.ai], b = nodes[e.bi];
            if (!a || !b) return null;
            const lit = focusPerson ? e.a === focusPerson || e.b === focusPerson : true;
            return (
              <line
                key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={REL_COLORS[e.type] ?? '#94a3b8'}
                strokeWidth={e.confidence === 'high' ? 1.6 : 0.9}
                strokeOpacity={lit ? 0.75 : 0.12}
              />
            );
          })}
          {nodes.map((n) => {
            const lit = focusPerson ? n.name === focusPerson : true;
            const dim = focusPerson ? !lit && !focusEdges.some((e) => e.a === n.name || e.b === n.name) : false;
            return (
              <g
                key={n.name}
                className="graph-node"
                transform={`translate(${n.x},${n.y})`}
                opacity={dim ? 0.28 : 1}
                onPointerDown={(e) => onPointerDownNode(e, n.name)}
                onClick={() => openGraph(n.name === focusPerson ? null : n.name)}
              >
                <circle
                  r={7 + Math.min(9, n.degree)}
                  fill={REGIMES[n.faction].color}
                  stroke={n.name === focusPerson ? '#ffffff' : 'rgba(8,11,16,0.85)'}
                  strokeWidth={n.name === focusPerson ? 2.2 : 0.9}
                />
                <text y={-11 - Math.min(9, n.degree)} textAnchor="middle">{n.name}</text>
              </g>
            );
          })}
        </g>
      </svg>
      {person && (
        <div className="graph-info">
          <p className="graph-name">
            {person.name}
            {person.title ? `(${person.title})` : ''}
            {person.life ? <small> {person.life}</small> : null}
          </p>
          <p className="graph-bio">{person.summary}</p>
          {focusEdges.length > 0 && (
            <p className="graph-rels">
              {focusEdges.map((e, i) => (
                <span key={i} className="graph-rel">
                  <i style={{ background: REL_COLORS[e.type] }} />
                  {e.a === focusPerson ? e.b : e.a}
                  <em>{e.type}</em>
                </span>
              ))}
            </p>
          )}
          {personEvents.length > 0 && (
            <div className="card-people">
              {personEvents.map((ev) => (
                <button
                  key={ev.id}
                  className="person graph-ev"
                  title={`${fmtDate(ev)} · ${ev.location} — ${ev.summary}`}
                  onClick={() => {
                    select(ev.id);
                    toggleGraph();
                  }}
                >
                  {ev.year} {ev.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="card-src">关系为自学史标注(顾诚《南明史》《明末农民战争史》《明史》《清史稿》),CBDB 批量抽取留作后续增量。</p>
    </aside>
  );
}
