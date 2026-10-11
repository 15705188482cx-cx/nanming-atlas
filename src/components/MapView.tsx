'use client';

import { useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import { EVENTS, EVENT_BY_ID } from '@/lib/data';
import { eventDistance, fmtDate } from '@/lib/time';
import { POLITIES, REGIMES } from '@/lib/types';
import type { PolityId } from '@/lib/types';
import { resolveSnapshot, snapsToFeatureCollection } from '@/lib/boundaries';
import type { RegimeSnapshot } from '@/lib/boundaries';
import { CAMPAIGNS, pathHead, pathSliced } from '@/lib/routes';
import type { CampaignRoute } from '@/lib/routes';
import { useAtlas } from '@/store';

const REGIME_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'regime'],
  'ming',
  REGIMES.ming.color,
  'qing',
  REGIMES.qing.color,
  'dashun',
  REGIMES.dashun.color,
  'daxi',
  REGIMES.daxi.color,
  'nanming',
  REGIMES.nanming.color,
  'zheng',
  REGIMES.zheng.color,
  '#94a3b8',
];

const FILL_BASE = 0.18;
const LINE_BASE = 0.75;
const CROSSFADE_MS = 650;

const REGIME_FC = snapsToFeatureCollection();

/** 全程参考线(静态):一条行军纵队 = 一条 LineString,随断面淡线铺底 */
const ROUTES_FULL: FeatureCollection = (() => {
  const features = CAMPAIGNS.flatMap((c: CampaignRoute) =>
    c.paths.map((p) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: p.points.map((pt) => [pt.lon, pt.lat]),
      },
      properties: { campaignId: c.id, campaignName: c.name, pathName: p.name, regime: p.regime },
    })),
  );
  return { type: 'FeatureCollection', features };
})();

/** 疆界面按政体着色(含蒙古/朝鲜/日本/荷兰等周边政权) */
const POLITY_COLOR = [
  'match',
  ['get', 'polity'],
  ...Object.entries(POLITIES).flatMap(([id, p]) => [id, p.color]),
  '#94a3b8',
] as unknown as ExpressionSpecification;

const snapFilter = (snapId: string): FilterSpecification =>
  ['==', ['get', 'snapId'], snapId];

const RADIUS: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  ['+', 1.8, ['*', 1.15, ['get', 'importance']]],
  6,
  ['+', 3.5, ['*', 2.4, ['get', 'importance']]],
];

// 含 zoom 的 interpolate 只能作为 paint 属性的顶层表达式,
// 选中/光环层的放大半径需各自写成独立 interpolate(基线 + 常量偏移)
const RADIUS_SELECTED: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  ['+', 4.8, ['*', 1.15, ['get', 'importance']]],
  6,
  ['+', 6.5, ['*', 2.4, ['get', 'importance']]],
];

const RADIUS_HALO: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  ['+', 10.8, ['*', 1.15, ['get', 'importance']]],
  6,
  ['+', 12.5, ['*', 2.4, ['get', 'importance']]],
];

/**
 * 事件源与图层直接写进初始 style:不依赖 load/style.load/isStyleLoaded——
 * 底图瓦片被限流重试时这些状态可能长期不就绪,而事件图层是内联 GeoJSON,
 * 随样式一起渲染(隔离实验验证),数据更新只需等 getSource 可用。
 * 疆界快照同理:单一 regimes 源 + A/B 双层,切换断面靠透明度 cross-fade。
 */
function makeStyle(initial: FeatureCollection<Point>): maplibregl.StyleSpecification {
  return {
  version: 8,
  sources: {
    esriDark: {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'Esri, HERE, Garmin, FAO, NOAA, USGS',
    },
    esriDarkRef: {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 16,
    },
    regimes: { type: 'geojson', data: REGIME_FC },
    routesFull: { type: 'geojson', data: ROUTES_FULL },
    routesLive: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    routesHead: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    events: { type: 'geojson', data: initial },
  },
  layers: [
    { id: 'basemap', type: 'raster', source: 'esriDark', paint: { 'raster-opacity': 0.9 } },
    { id: 'basemap-labels', type: 'raster', source: 'esriDarkRef', paint: { 'raster-opacity': 0.5 } },
    {
      id: 'regimes-fill-a',
      type: 'fill',
      source: 'regimes',
      filter: snapFilter('__none__'),
      paint: { 'fill-color': POLITY_COLOR, 'fill-opacity': 0 },
    },
    {
      id: 'regimes-fill-b',
      type: 'fill',
      source: 'regimes',
      filter: snapFilter('__none__'),
      paint: { 'fill-color': POLITY_COLOR, 'fill-opacity': 0 },
    },
    {
      id: 'regimes-line-a',
      type: 'line',
      source: 'regimes',
      filter: snapFilter('__none__'),
      paint: { 'line-color': POLITY_COLOR, 'line-width': 1, 'line-opacity': 0 },
    },
    {
      id: 'regimes-line-b',
      type: 'line',
      source: 'regimes',
      filter: snapFilter('__none__'),
      paint: { 'line-color': POLITY_COLOR, 'line-width': 1, 'line-opacity': 0 },
    },
    {
      id: 'routes-full',
      type: 'line',
      source: 'routesFull',
      paint: {
        'line-color': REGIME_COLOR,
        'line-width': 1.1,
        'line-opacity': 0.25,
        'line-dasharray': [1.5, 1.5],
      },
    },
    {
      id: 'routes-live',
      type: 'line',
      source: 'routesLive',
      paint: {
        'line-color': REGIME_COLOR,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          2.2,
          6,
          3.6,
        ] as unknown as ExpressionSpecification,
        'line-opacity': 0.85,
      },
    },
    {
      id: 'routes-head',
      type: 'circle',
      source: 'routesHead',
      paint: {
        'circle-radius': 3.8,
        'circle-color': '#ffffff',
        'circle-stroke-color': REGIME_COLOR,
        'circle-stroke-width': 1.6,
        'circle-opacity': 0.95,
      },
    },
    {
      id: 'events-halo',
      type: 'circle',
      source: 'events',
      filter: ['==', ['get', 'id'], '__none__'],
      paint: {
        'circle-radius': RADIUS_HALO,
        'circle-color': '#ffffff',
        'circle-opacity': 0.12,
        'circle-stroke-width': 0,
      },
    },
    {
      id: 'events-base',
      type: 'circle',
      source: 'events',
      paint: {
        'circle-radius': RADIUS,
        'circle-color': REGIME_COLOR,
        'circle-opacity': ['get', 'op'],
        'circle-stroke-width': 0.8,
        'circle-stroke-color': 'rgba(8,11,16,0.85)',
      },
    },
    {
      id: 'events-selected',
      type: 'circle',
      source: 'events',
      filter: ['==', ['get', 'id'], '__none__'],
      paint: {
        'circle-radius': RADIUS_SELECTED,
        'circle-color': REGIME_COLOR,
        'circle-opacity': 1,
        'circle-stroke-width': 1.6,
        'circle-stroke-color': '#ffffff',
      },
    },
  ],
  };
}

function eventsToFeatures(
  events: typeof EVENTS,
  year: number,
  win: number,
): FeatureCollection<Point> {
  const features = events
    .slice()
    .sort((a, b) => b.importance - a.importance)
    .map((e) => {
      const dist = win === 0 ? 0 : eventDistance(e, year);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [e.lon, e.lat] },
        properties: {
          id: e.id,
          title: e.title,
          regime: e.regime,
          importance: e.importance,
          op: dist <= win ? 0.95 : 0.14,
          date: fmtDate(e),
        },
      };
    });
  return { type: 'FeatureCollection', features };
}

const REGIME_LAYERS = ['regimes-fill-a', 'regimes-fill-b', 'regimes-line-a', 'regimes-line-b'];
const CHGIS_LAYERS = ['chgis-fill', 'chgis-line'];
const ROUTE_LAYERS = ['routes-full', 'routes-live', 'routes-head'];

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const animRef = useRef(0);
  const frontLayer = useRef<'a' | 'b'>('a');
  const currentSnapRef = useRef('');

  const year = useAtlas((s) => s.year);
  const win = useAtlas((s) => s.windowYears);
  const selectedId = useAtlas((s) => s.selectedId);
  const regimeFilter = useAtlas((s) => s.regimeFilter);
  const categoryFilter = useAtlas((s) => s.categoryFilter);
  const showBoundaries = useAtlas((s) => s.showBoundaries);
  const showRoutes = useAtlas((s) => s.showRoutes);
  const routeFilter = useAtlas((s) => s.routeFilter);
  const select = useAtlas((s) => s.select);

  const snapYear = Math.floor(year);
  const snap = useMemo(() => resolveSnapshot(snapYear), [snapYear]);

  const filtered = useMemo(
    () =>
      EVENTS.filter(
        (e) => regimeFilter[e.regime] !== false && categoryFilter[e.category] !== false,
      ),
    [regimeFilter, categoryFilter],
  );

  const featureData = useMemo<FeatureCollection<Point>>(
    () => eventsToFeatures(filtered, year, win),
    [filtered, year, win],
  );

  // 断面切换:front 层淡出、back 层淡入(rAF 缓动,HyperDeem 契约的 maplibre 版)
  const transitionTo = (target: RegimeSnapshot) => {
    const map = mapRef.current;
    if (!map || !map.getLayer('regimes-fill-a')) return;
    if (!currentSnapRef.current) {
      // 首绘:直接点亮 front 层,不做动画
      frontLayer.current = 'a';
      for (const suffix of ['fill', 'line']) {
        map.setFilter(`regimes-${suffix}-a`, snapFilter(target.id));
      }
      map.setPaintProperty('regimes-fill-a', 'fill-opacity', FILL_BASE);
      map.setPaintProperty('regimes-line-a', 'line-opacity', LINE_BASE);
      currentSnapRef.current = target.id;
      return;
    }
    if (currentSnapRef.current === target.id) return;
    cancelAnimationFrame(animRef.current);

    const from = frontLayer.current;
    const to = from === 'a' ? 'b' : 'a';
    for (const suffix of ['fill', 'line']) {
      map.setFilter(`regimes-${suffix}-${to}`, snapFilter(target.id));
    }
    // 起点取当前实际透明度:播放中途连续切换时不回跳
    const f0 = map.getPaintProperty(`regimes-fill-${from}`, 'fill-opacity') as unknown;
    const l0 = map.getPaintProperty(`regimes-line-${from}`, 'line-opacity') as unknown;
    const fillFrom = typeof f0 === 'number' ? f0 : FILL_BASE;
    const lineFrom = typeof l0 === 'number' ? l0 : LINE_BASE;
    const fillTo = FILL_BASE - fillFrom;
    const lineTo = LINE_BASE - lineFrom;

    const t0 = performance.now();
    const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / CROSSFADE_MS);
      const k = ease(t);
      map.setPaintProperty(`regimes-fill-${from}`, 'fill-opacity', fillFrom * (1 - k));
      map.setPaintProperty(`regimes-line-${from}`, 'line-opacity', lineFrom * (1 - k));
      map.setPaintProperty(`regimes-fill-${to}`, 'fill-opacity', fillTo + (FILL_BASE - fillTo) * k);
      map.setPaintProperty(`regimes-line-${to}`, 'line-opacity', lineTo + (LINE_BASE - lineTo) * k);
      if (t < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        frontLayer.current = to;
        currentSnapRef.current = target.id;
      }
    };
    animRef.current = requestAnimationFrame(step);
  };

  // CHGIS 政区层按断面锚定年过滤(时序数据自带起止年)
  const applyChgisFilter = (anchorYear: number) => {
    const map = mapRef.current;
    if (!map || !map.getLayer('chgis-fill')) return;
    const f = [
      'all',
      ['<=', ['get', 'begYr'], anchorYear],
      ['>=', ['get', 'endYr'], anchorYear],
    ] as FilterSpecification;
    map.setFilter('chgis-fill', f);
    map.setFilter('chgis-line', f);
  };

  // 初始化地图与交互(一次)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeStyle(eventsToFeatures(EVENTS, year, win)),
      center: [112.5, 30.5],
      zoom: 3.9,
      minZoom: 2.6,
      maxZoom: 9,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    let disposed = false;
    // 就绪信号:样式处理完成后 getLayer 才可用(getSource/isStyleLoaded 在样式
    // 未就绪时同样返回 falsy,但栅格瓦片缓慢时它们可能长期不可靠)
    const whenReady = (fn: (m: maplibregl.Map) => void) => {
      const poll = () => {
        if (disposed || !mapRef.current) return;
        if (mapRef.current.getLayer('events-base')) fn(mapRef.current);
        else window.setTimeout(poll, 150);
      };
      poll();
    };

    whenReady((m) => {
      m.resize();
      window.setTimeout(() => m.resize(), 500);

      m.on('click', 'events-base', (e) => {
        const f = e.features?.[0];
        if (f?.properties?.id) select(f.properties.id as string);
      });
      m.on('click', (e) => {
        const hits = m.queryRenderedFeatures(e.point, { layers: ['events-base'] });
        if (!hits.length) select(null);
      });
      m.on('mouseenter', 'events-base', () => {
        m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', 'events-base', () => {
        m.getCanvas().style.cursor = '';
        popupRef.current?.remove();
      });
      m.on('mousemove', 'events-base', (e) => {
        const f = e.features?.[0];
        if (!f?.properties) return;
        if (!popupRef.current) {
          popupRef.current = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 14,
            className: 'nm-popup',
          });
        }
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${f.properties.title}</strong><span>${f.properties.date}</span>`)
          .addTo(m);
      });

      // 政权面悬停:显示政体与区块名(与事件弹泡共用一个 Popup)
      const showPopup = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const f = e.features?.[0];
        if (!f?.properties) return;
        const p = POLITIES[f.properties.polity as PolityId];
        if (!popupRef.current) {
          popupRef.current = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 8,
            className: 'nm-popup',
          });
        }
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${f.properties.name}</strong><span>${p?.label ?? f.properties.polity} · 疆界示意</span>`,
          )
          .addTo(m);
      };
      for (const layer of ['regimes-fill-a', 'regimes-fill-b']) {
        m.on('mousemove', layer, showPopup);
        m.on('mouseleave', layer, () => popupRef.current?.remove());
      }

      // 行军路线悬停
      const showRoutePopup = (
        e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
      ) => {
        const f = e.features?.[0];
        if (!f?.properties) return;
        if (!popupRef.current) {
          popupRef.current = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 8,
            className: 'nm-popup',
          });
        }
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${f.properties.campaignName}</strong><span>${f.properties.pathName} · 行军路线(示意)</span>`,
          )
          .addTo(m);
      };
      for (const layer of ['routes-full', 'routes-live']) {
        m.on('mousemove', layer, showRoutePopup);
        m.on('mouseleave', layer, () => popupRef.current?.remove());
      }

      // CHGIS 政区打底:本地生成文件(public/chgis.local.json)存在才加载,
      // 不存在则静默跳过——许可数据不入库,见 scripts/build-chgis.mjs
      fetch('/chgis.local.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((data: unknown) => {
          if (disposed || !mapRef.current || !data) return;
          const mm = mapRef.current;
          if (mm.getLayer('chgis-fill')) return;
          mm.addSource('chgis', { type: 'geojson', data: data as GeoJSON.FeatureCollection });
          mm.addLayer(
            {
              id: 'chgis-fill',
              type: 'fill',
              source: 'chgis',
              filter: ['all', ['<=', ['get', 'begYr'], snapYear], ['>=', ['get', 'endYr'], snapYear]],
              paint: { 'fill-color': '#8a7f6a', 'fill-opacity': 0.07 },
            },
            'regimes-fill-a',
          );
          mm.addLayer(
            {
              id: 'chgis-line',
              type: 'line',
              source: 'chgis',
              filter: ['all', ['<=', ['get', 'begYr'], snapYear], ['>=', ['get', 'endYr'], snapYear]],
              paint: { 'line-color': 'rgba(190,178,150,0.4)', 'line-width': 0.7 },
            },
            'regimes-fill-a',
          );
          if (!useAtlas.getState().showBoundaries) {
            mm.setLayoutProperty('chgis-fill', 'visibility', 'none');
            mm.setLayoutProperty('chgis-line', 'visibility', 'none');
          }
          useAtlas.getState().setChgisLoaded(true);
        })
        .catch(() => {});
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animRef.current);
      map.remove();
      mapRef.current = null;
      popupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 断面切换(依赖快照 id,而非逐帧 year)
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      if (!mapRef.current?.getLayer('regimes-fill-a')) {
        window.setTimeout(apply, 150);
        return;
      }
      transitionTo(snap);
      applyChgisFilter(snap.year);
    };
    apply();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  // 疆界层可见性
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const map = mapRef.current;
      if (!map || !map.getLayer('regimes-fill-a')) {
        window.setTimeout(apply, 150);
        return;
      }
      const v = showBoundaries ? 'visible' : 'none';
      for (const l of [...REGIME_LAYERS, ...CHGIS_LAYERS]) {
        if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', v);
      }
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, [showBoundaries]);

  // 行军路线可见性
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const map = mapRef.current;
      if (!map || !map.getLayer('routes-full')) {
        window.setTimeout(apply, 150);
        return;
      }
      const v = showRoutes ? 'visible' : 'none';
      for (const l of ROUTE_LAYERS) map.setLayoutProperty(l, 'visibility', v);
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, [showRoutes]);

  // 行军路线逐帧推进:已行进亮线切片 + 头部动点 + 单路线开关过滤
  // (播放时 year 每帧变化,数据量为几条短折线,setData 开销可忽略)
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const map = mapRef.current;
      if (!map || !map.getSource('routesLive')) {
        window.setTimeout(apply, 150);
        return;
      }
      const visible = CAMPAIGNS.filter((c) => routeFilter[c.id] !== false).map((c) => c.id);
      const camFilter = ['in', ['get', 'campaignId'], ['literal', visible]] as FilterSpecification;
      map.setFilter('routes-full', camFilter);
      map.setFilter('routes-live', camFilter);
      map.setFilter('routes-head', camFilter);

      const lines: FeatureCollection = { type: 'FeatureCollection', features: [] };
      const heads: FeatureCollection = { type: 'FeatureCollection', features: [] };
      for (const c of CAMPAIGNS) {
        if (routeFilter[c.id] === false) continue;
        for (const p of c.paths) {
          const sliced = pathSliced(p, year);
          if (sliced) {
            lines.features.push({
              type: 'Feature',
              geometry: sliced,
              properties: { campaignId: c.id, campaignName: c.name, pathName: p.name, regime: p.regime },
            });
          }
          const head = pathHead(p, year);
          if (head) {
            heads.features.push({
              type: 'Feature',
              geometry: head,
              properties: { campaignId: c.id, campaignName: c.name, pathName: p.name, regime: p.regime },
            });
          }
        }
      }
      (map.getSource('routesLive') as maplibregl.GeoJSONSource).setData(lines);
      (map.getSource('routesHead') as maplibregl.GeoJSONSource).setData(heads);
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, [year, routeFilter]);

  // 数据/明暗更新(source 句柄在样式处理完成前不可得,轮询重试)
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const src = mapRef.current?.getSource('events') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(featureData);
      else window.setTimeout(apply, 150);
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, [featureData]);

  // 选中态:高亮 + 飞行定位
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const map = mapRef.current;
      if (!map || !map.getSource('events')) {
        window.setTimeout(apply, 120);
        return;
      }
      const f = selectedId ?? '__none__';
      for (const layer of ['events-selected', 'events-halo']) {
        if (map.getLayer(layer)) map.setFilter(layer, ['==', ['get', 'id'], f]);
      }
      const ev = selectedId ? EVENT_BY_ID.get(selectedId) : null;
      if (ev) {
        map.flyTo({
          center: [ev.lon, ev.lat],
          zoom: Math.max(map.getZoom(), 5.2),
          duration: 700,
          padding: { top: 60, bottom: 200, left: 40, right: 380 },
        });
      }
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return <div ref={containerRef} className="map-root" />;
}
