import rawEvents from '../../data/events.json';
import rawPeople from '../../data/people.json';
import kbEvents from '../../data/kb-events.json';
import kbPeople from '../../data/kb-people.json';
import type { AtlasEvent, AtlasPerson } from './types';

/**
 * 数据两层:
 *  - data/events|people.json:M1 自建种子数据(build-data.mjs 门禁产物)
 *  - data/kb-*.json:知识库(PG)导出的抽取数据(出处引文在 sources 字段)
 * 合并后供地图/图谱/事件卡统一消费。
 */
export const EVENTS = [...(rawEvents as unknown as AtlasEvent[]), ...(kbEvents as unknown as AtlasEvent[])];
export const PEOPLE = [...(rawPeople as unknown as AtlasPerson[]), ...(kbPeople as unknown as AtlasPerson[])];

export const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));
export const PERSON_BY_NAME = new Map(PEOPLE.map((p) => [p.name, p]));
