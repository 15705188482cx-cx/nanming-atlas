import rawRels from '../../data/relations.json';
import kbRels from '../../data/kb-relations.json';
import { EVENTS, PEOPLE } from './data';
import type { AtlasEvent, RegimeId } from './types';

export interface PersonRelation {
  /** 关系类型(枚举见 build 门禁 REL_TYPES) */
  type: string;
  /** 对称关系:两端为人名(人物索引中的 name) */
  a: string;
  b: string;
  note: string;
  confidence: 'high' | 'medium';
}

export const RELATIONS = [...(rawRels as unknown as PersonRelation[]), ...(kbRels as unknown as PersonRelation[])];

/** 关系类型配色(图例与边着色) */
export const REL_COLORS: Record<string, string> = {
  君臣: '#f2c94c',
  父子: '#52b788',
  兄弟: '#74b3a4',
  叔侄: '#a3c9a8',
  师生: '#8fd3f4',
  同僚: '#b08968',
  荐举: '#c9a7eb',
  同盟: '#6a9fdc',
  反目: '#e07ae5',
  敌对: '#e05d4f',
  舅甥: '#a3c9a8',
  姻亲: '#d9a7e0',
};

export interface GraphNode {
  name: string;
  faction: RegimeId;
  /** 关系边数(节点大小) */
  degree: number;
}

export const GRAPH_NODES: GraphNode[] = (() => {
  const deg = new Map<string, number>();
  for (const r of RELATIONS) {
    deg.set(r.a, (deg.get(r.a) ?? 0) + 1);
    deg.set(r.b, (deg.get(r.b) ?? 0) + 1);
  }
  return PEOPLE.map((p) => ({ name: p.name, faction: p.faction, degree: deg.get(p.name) ?? 0 }));
})();

/** 某人物的相关事件(事件.people 引用人名),按时间升序 */
export function eventsOfPerson(name: string): AtlasEvent[] {
  return EVENTS_BY_PERSON.get(name) ?? [];
}
const EVENTS_BY_PERSON = (() => {
  const m = new Map<string, AtlasEvent[]>();
  for (const ev of EVENTS) {
    for (const n of ev.people) {
      if (!m.has(n)) m.set(n, []);
      m.get(n)!.push(ev);
    }
  }
  for (const list of m.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return m;
})();
