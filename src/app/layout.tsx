import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

export const metadata: Metadata = {
  title: '南明舆图 · Nanming Atlas',
  description:
    '明末—南明(1582–1664)历史时空可视化:疆界变迁、军队行进、大事件时间轴与人物图谱的四层联动。M1:事件时间轴 + 地图点位。',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
