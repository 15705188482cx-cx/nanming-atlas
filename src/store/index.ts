'use client';

import { create } from 'zustand';
import type { AtlasState } from './types-store';

export const useAtlas = create<AtlasState>((set) => ({
  year: 1644,
  playing: false,
  speed: 3,
  selectedId: null,
  windowYears: 2,
  regimeFilter: {},
  categoryFilter: {},
  showBoundaries: true,
  showRoutes: true,
  routeFilter: {},
  chgisLoaded: false,
  graphOpen: false,
  focusPerson: null,
  view3d: false,
  setYear: (year) => set({ year }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  select: (selectedId) => set({ selectedId }),
  setWindow: (windowYears) => set({ windowYears }),
  toggleBoundaries: () => set((s) => ({ showBoundaries: !s.showBoundaries })),
  toggleRoutes: () => set((s) => ({ showRoutes: !s.showRoutes })),
  toggleRoute: (id) =>
    set((s) => ({ routeFilter: { ...s.routeFilter, [id]: s.routeFilter[id] === false ? true : false } })),
  toggleGraph: () => set((s) => ({ graphOpen: !s.graphOpen })),
  openGraph: (person) => set({ graphOpen: true, focusPerson: person }),
  toggleView3d: () => set((s) => ({ view3d: !s.view3d })),
  setChgisLoaded: (chgisLoaded) => set({ chgisLoaded }),
  toggleRegime: (r) =>
    set((s) => ({ regimeFilter: { ...s.regimeFilter, [r]: s.regimeFilter[r] === false ? true : false } })),
  toggleCategory: (c) =>
    set((s) => ({ categoryFilter: { ...s.categoryFilter, [c]: s.categoryFilter[c] === false ? true : false } })),
}));
