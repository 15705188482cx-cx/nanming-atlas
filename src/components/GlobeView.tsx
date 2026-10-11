'use client';

import { useEffect, useRef } from 'react';
import { EVENT_BY_ID, EVENTS } from '@/lib/data';
import { eventDistance } from '@/lib/time';
import { REGIMES, POLITIES } from '@/lib/types';
import { resolveSnapshot } from '@/lib/boundaries';
import { CAMPAIGNS, pathSliced } from '@/lib/routes';
import { useAtlas } from '@/store';
import 'cesium/Build/Cesium/Widgets/widgets.css';

/**
 * 地球视角(M6:Cesium 实现,替换 M5 自研 Canvas 正交球):
 * 与 2D 共用同一份数据与状态——疆界快照按年份切换(阵营配色)、事件点按窗口明暗、
 * 行军亮线随播放头推进;拖拽旋转/滚轮缩放/静置 4 秒自动缓旋;点事件即联动事件卡。
 * 底图复用 2D 同源 Esri 深灰瓦片;零 ion token(显式 baseLayer,不碰默认资产)。
 * Cesium 经 dynamic import 懒加载:首载体积不含引擎,Workers/Assets 运行时按需拉取。
 */

const ESRI_DARK =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const ESRI_DARK_REF =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';

export default function GlobeView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const rebuildRef = useRef<(() => void) | null>(null);
  const lastTouch = useRef(0);
  const snapId = useRef<string | null>(null);

  const year = useAtlas((s) => s.year);
  const win = useAtlas((s) => s.windowYears);
  const selectedId = useAtlas((s) => s.selectedId);
  const regimeFilter = useAtlas((s) => s.regimeFilter);
  const categoryFilter = useAtlas((s) => s.categoryFilter);
  const select = useAtlas((s) => s.select);

  const state = useRef({ year, win, selectedId, regimeFilter, categoryFilter });
  state.current = { year, win, selectedId, regimeFilter, categoryFilter };

  useEffect(() => {
    let destroyed = false;
    let viewer: any = null;
    let regimesSource: any = null;
    let routesSource: any = null;
    let eventsSource: any = null;
    let removeTick: (() => void) | null = null;
    let removeHandler: (() => void) | null = null;

    (async () => {
      (window as any).CESIUM_BASE_URL = '/cesium/';
      const Cesium = await import('cesium');
      cesiumRef.current = Cesium;
      if (destroyed || !wrapRef.current) return;

      const baseProvider = new Cesium.UrlTemplateImageryProvider({
        url: ESRI_DARK,
        maximumLevel: 16,
        credit: 'Esri, HERE, Garmin, FAO, NOAA, USGS',
      });
      viewer = new Cesium.Viewer(wrapRef.current, {
        baseLayer: new Cesium.ImageryLayer(baseProvider),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
      });
      viewerRef.current = viewer;
      const scene = viewer.scene;
      scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a1220');
      const refLayer = viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: ESRI_DARK_REF,
          maximumLevel: 16,
          credit: 'Esri',
        }),
      );
      refLayer.alpha = 0.5;

      viewer.cesiumWidget.creditContainer.style.display = 'none';
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(108, 30, 9_500_000),
      });

      const toDeg = (ring: [number, number][]) =>
        ring.map(([lon, lat]) => [lon, lat] as [number, number]);

      // ── 疆界快照(阵营配色;断面变化时重建) ──
      const buildRegimes = () => {
        const snap = resolveSnapshot(Math.floor(state.current.year));
        if (snapId.current === snap.id) return;
        snapId.current = snap.id;
        if (regimesSource) {
          viewer.dataSources.remove(regimesSource, true);
          regimesSource = null;
        }
        const fc = {
          type: 'FeatureCollection' as const,
          features: snap.features.flatMap((f) => {
            const color = POLITIES[f.polity]?.color ?? '#94a3b8';
            return f.rings.map((ring) => ({
              type: 'Feature' as const,
              properties: { color },
              geometry: { type: 'Polygon' as const, coordinates: [toDeg(ring)] },
            }));
          }),
        };
        Cesium.GeoJsonDataSource.load(fc, {
          fill: Cesium.Color.WHITE.withAlpha(0.01),
        }).then((ds: any) => {
          if (destroyed) return;
          for (const e of ds.entities.values) {
            const color = Cesium.Color.fromCssColorString(e.properties.color.getValue());
            e.polygon.material = color.withAlpha(0.22);
            e.polygon.outline = false;
            e.polygon.heightReference = 0;
            // 边界线(Windows 下 outlineWidth 无效,用叠加 polyline)
            const ring = e.polygon.hierarchy.getValue().positions;
            ds.entities.add({
              polyline: {
                positions: [...ring, ring[0]],
                width: 1.6,
                material: new Cesium.PolylineDashMaterialProperty({
                  color: color.withAlpha(0.85),
                }),
                clampToGround: true,
              },
            });
          }
          regimesSource = ds;
          viewer.dataSources.add(ds);
        });
      };

      // ── 行军路线:全程淡虚线 + 已行进亮线(随播放头) ──
      routesSource = new Cesium.CustomDataSource('routes');
      viewer.dataSources.add(routesSource);
      for (const c of CAMPAIGNS) {
        for (const p of c.paths) {
          const full = p.points.flatMap((pt) => [pt.lon, pt.lat]);
          routesSource.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(full),
              width: 1,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.fromCssColorString(REGIMES[p.regime].color).withAlpha(0.3),
              }),
              clampToGround: true,
            },
          });
          routesSource.entities.add({
            polyline: {
              positions: new Cesium.CallbackProperty(() => {
                const sliced = pathSliced(p, state.current.year);
                if (!sliced) return [];
                return Cesium.Cartesian3.fromDegreesArray(
                  sliced.coordinates.flat() as number[],
                );
              }, false),
              width: 2.4,
              material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.25,
                color: Cesium.Color.fromCssColorString(REGIMES[p.regime].color).withAlpha(0.95),
              }),
              clampToGround: true,
            },
          });
        }
      }

      // ── 事件点:按窗口明暗(同 2D 口径),点选联动 ──
      eventsSource = new Cesium.CustomDataSource('events');
      viewer.dataSources.add(eventsSource);
      for (const e of EVENTS) {
        if (state.current.regimeFilter[e.regime] === false) continue;
        const color = Cesium.Color.fromCssColorString(REGIMES[e.regime].color);
        eventsSource.entities.add({
          id: e.id,
          position: Cesium.Cartesian3.fromDegrees(e.lon, e.lat, 0),
          point: {
            pixelSize: new Cesium.CallbackProperty(
              () => 3.2 + e.importance * 1.6, false),
            color: new Cesium.CallbackProperty(() => {
              const st = state.current;
              const dist = st.win === 0 ? 0 : eventDistance(e, st.year);
              return color.withAlpha(dist <= st.win ? 0.95 : 0.16);
            }, false),
            outlineColor: new Cesium.CallbackProperty(() =>
              e.id === state.current.selectedId
                ? Cesium.Color.WHITE
                : color.withAlpha(0.4), false),
            outlineWidth: 1.6,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }

      // ── 交互:点选事件 / 交互计时(自转用) ──
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement: any) => {
        lastTouch.current = performance.now();
        const picked = viewer.scene.pick(movement.position);
        const id = picked?.id?.id;
        if (id && EVENT_BY_ID.has(id)) select(id);
        else select(null);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction(() => {
        lastTouch.current = performance.now();
      }, Cesium.ScreenSpaceEventType.WHEEL);
      handler.setInputAction(() => {
        lastTouch.current = performance.now();
      }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
      removeHandler = () => handler.destroy();

      // ── 静置 4s 自动缓旋 ──
      lastTouch.current = performance.now();
      const onTick = () => {
        if (performance.now() - lastTouch.current > 4000) {
          viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.00045);
        }
      };
      viewer.clock.onTick.addEventListener(onTick);
      removeTick = () => viewer.clock.onTick.removeEventListener(onTick);

      buildRegimes();
      rebuildRef.current = buildRegimes;
    })();

    return () => {
      destroyed = true;
      removeTick?.();
      removeHandler?.();
      if (viewer && !viewer.isDestroyed?.()) viewer.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 断面重建:定时检查快照 id,变化才重建(500ms 轮询,成本可忽略)
  useEffect(() => {
    const t = setInterval(() => {
      const snap = resolveSnapshot(Math.floor(useAtlas.getState().year));
      if (snapId.current !== snap.id) rebuildRef.current?.();
    }, 500);
    return () => clearInterval(t);
  }, []);

  // 选中事件:转镜头至事件上空
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!selectedId || !viewer || viewer.isDestroyed?.() || !Cesium) return;
    const ev = EVENT_BY_ID.get(selectedId);
    if (!ev) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(ev.lon, Math.max(-75, Math.min(75, ev.lat * 0.85)), 2_600_000),
      duration: 1.2,
    });
    lastTouch.current = performance.now();
  }, [selectedId]);

  return (
    <div ref={wrapRef} className="map-root globe-root globe-cesium">
      <span className="globe-hint">三维地球 · 拖拽旋转 / 滚轮缩放 / 点击事件点</span>
    </div>
  );
}
