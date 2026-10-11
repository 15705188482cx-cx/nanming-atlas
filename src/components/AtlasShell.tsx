'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import EventCard from './EventCard';
import BoundaryBar from './BoundaryBar';
import FilterBar from './FilterBar';
import PersonGraph from './PersonGraph';
import RouteBar from './RouteBar';
import Timeline from './Timeline';
import { Y_MAX, Y0, clampYear } from '@/lib/time';
import { useAtlas } from '@/store';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="map-root map-loading">底图加载中…</div>,
});

const GlobeView = dynamic(() => import('./GlobeView'), {
  ssr: false,
  loading: () => <div className="map-root map-loading">地球加载中…</div>,
});

export default function AtlasShell() {
  const playing = useAtlas((s) => s.playing);
  const graphOpen = useAtlas((s) => s.graphOpen);
  const view3d = useAtlas((s) => s.view3d);

  // 播放循环
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      const { year, speed, setYear, setPlaying } = useAtlas.getState();
      const y = year + dt * speed;
      if (y >= Y_MAX) {
        setYear(Y_MAX);
        setPlaying(false);
      } else {
        setYear(y);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // 键盘:← → 步进,空格播放,Esc 取消选中
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const s = useAtlas.getState();
      if (e.key === 'ArrowLeft') s.setYear(clampYear(Math.floor(s.year) - 1));
      else if (e.key === 'ArrowRight') s.setYear(clampYear(Math.floor(s.year) + 1));
      else if (e.key === ' ') {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.key === 'Escape') s.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main className="shell">
      {view3d ? <GlobeView /> : <MapView />}
      <header className="hdr">
        <h1>南明舆图</h1>
        <p className="hdr-sub">明末—南明 · 1582–1664 · 事件时间轴与地图联动</p>
        <p className="hdr-hint">拖动底部时间轴或按空格播放 · 点击圆点阅读事件</p>
      </header>
      <FilterBar />
      <RouteBar />
      <BoundaryBar />
      {graphOpen ? <PersonGraph /> : <EventCard />}
      <Timeline />
    </main>
  );
}
