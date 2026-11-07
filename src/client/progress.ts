// 戦績・称号・デイリーミッション・チュートリアルの進み具合（端末のブラウザに保存）

import { CHARACTERS, getCharacter } from '../shared/characters';
import { GACHA_COSTUMES } from '../shared/costumes';
import { dayKey, type Wallet } from './wallet';

const KEY = 'buttobi-progress-v1';

export interface CharRecord {
  matches: number;
  wins: number;
  kos: number;
  falls: number;
  dealt: number;
}

export interface Totals {
  matches: number;
  wins: number;
  kos: number;
  throws: number;
  taunts: number;
  specials: number;
  items: number;
}

export interface MissionState {
  id: string;
  progress: number;
  done: boolean;
}

export interface Progress {
  records: Record<string, CharRecord>;
  totals: Totals;
  /** 手に入れた称号 */
  titles: string[];
  missions: { day: string; list: MissionState[]; bonus: boolean };
  tutorialDone: boolean;
  /** チュートリアルをやるか一度聞いた */
  tutorialAsked?: boolean;
}

/** 1試合の自分の成績（main.ts で数える） */
export interface MatchStats {
  charId: string;
  won: boolean;
  kos: number;
  falls: number;
  dealt: number;
  throws: number;
  taunts: number;
  specials: number;
  smashes: number;
  items: number;
}

// ---------------------------------------------------------------- 称号
export interface TitleDef {
  id: string;
  name: string;
  /** 手に入れる条件（表示用） */
  cond: string;
  coins: number;
  check(p: Progress, w: Wallet): boolean;
}

export const TITLES: TitleDef[] = [
  { id: 'win1', name: 'はじめての勝利', cond: '1回勝つ', coins: 50, check: (p) => p.totals.wins >= 1 },
  { id: 'win10', name: '駆け出しファイター', cond: '通算10勝', coins: 100, check: (p) => p.totals.wins >= 10 },
  { id: 'win50', name: '歴戦の勇者', cond: '通算50勝', coins: 200, check: (p) => p.totals.wins >= 50 },
  { id: 'win100', name: 'ぶっとびの王', cond: '通算100勝', coins: 500, check: (p) => p.totals.wins >= 100 },
  { id: 'ko50', name: '撃墜王', cond: '通算50撃墜', coins: 150, check: (p) => p.totals.kos >= 50 },
  { id: 'throw30', name: '投げ名人', cond: '投げを30回決める', coins: 100, check: (p) => p.totals.throws >= 30 },
  { id: 'taunt20', name: '目立ちたがり', cond: 'アピールを20回する', coins: 50, check: (p) => p.totals.taunts >= 20 },
  { id: 'item30', name: 'アイテムハンター', cond: 'アイテムを30回拾う', coins: 100, check: (p) => p.totals.items >= 30 },
  { id: 'costume12', name: 'おしゃれさん', cond: '衣装を12着集める', coins: 150, check: (_p, w) => w.owned.length >= 12 },
  { id: 'costumeAll', name: 'コンプリート', cond: '衣装を全部集める', coins: 500, check: (_p, w) => GACHA_COSTUMES.every((c) => w.owned.includes(c.id)) },
  { id: 'login7', name: '皆勤賞', cond: '7日連続でログイン', coins: 100, check: (_p, w) => w.streak >= 7 },
  ...CHARACTERS.map((c) => ({
    id: `master-${c.id}`,
    name: `${c.name}マスター`,
    cond: `${c.name}で10勝`,
    coins: 100,
    check: (p: Progress) => (p.records[c.id]?.wins ?? 0) >= 10,
  })),
];

// ---------------------------------------------------------------- デイリーミッション
export interface MissionDef {
  id: string;
  /** 表示用の説明（キャラ指定のミッションは日ごとに変わる） */
  text(day: string): string;
  goal: number;
  /** 1試合ぶんでどれだけ進むか */
  add(s: MatchStats, day: string): number;
}

/** 日付から決まる「今日のキャラ」 */
function charOfDay(day: string): string {
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CHARACTERS[h % CHARACTERS.length].id;
}

export const MISSIONS: MissionDef[] = [
  { id: 'play2', text: () => '対戦を2回する', goal: 2, add: () => 1 },
  { id: 'win1', text: () => '対戦で1回勝つ', goal: 1, add: (s) => (s.won ? 1 : 0) },
  { id: 'ko3', text: () => '相手を3回撃墜する', goal: 3, add: (s) => s.kos },
  { id: 'special10', text: () => '必殺技を10回使う', goal: 10, add: (s) => s.specials },
  { id: 'throw3', text: () => '投げを3回決める', goal: 3, add: (s) => s.throws },
  { id: 'smash3', text: () => 'スマッシュ攻撃か溜め攻撃を3回出す', goal: 3, add: (s) => s.smashes },
  { id: 'taunt1', text: () => 'アピールを1回する', goal: 1, add: (s) => s.taunts },
  { id: 'item2', text: () => 'アイテムを2回拾う', goal: 2, add: (s) => s.items },
  { id: 'char1', text: (d) => `${getCharacter(charOfDay(d)).name}で1回対戦する`, goal: 1, add: (s, d) => (s.charId === charOfDay(d) ? 1 : 0) },
];

/** ミッション1つの報酬と、3つ全部やったときのおまけ */
export const MISSION_REWARD = 50;
export const MISSION_BONUS = 100;

function freshMissions(day: string): Progress['missions'] {
  // 日付から3つ選ぶ（同じ日なら毎回同じ）
  let h = 7;
  for (const ch of day) h = (h * 131 + ch.charCodeAt(0)) >>> 0;
  const pool = [...MISSIONS];
  const list: MissionState[] = [];
  for (let i = 0; i < 3; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const m = pool.splice(h % pool.length, 1)[0];
    list.push({ id: m.id, progress: 0, done: false });
  }
  return { day, list, bonus: false };
}

function fresh(): Progress {
  return {
    records: {},
    totals: { matches: 0, wins: 0, kos: 0, throws: 0, taunts: 0, specials: 0, items: 0 },
    titles: [],
    missions: freshMissions(dayKey(new Date())),
    tutorialDone: false,
  };
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = { ...fresh(), ...JSON.parse(raw) } as Progress;
    p.totals = { ...fresh().totals, ...p.totals };
    if (!Array.isArray(p.titles)) p.titles = [];
    if (!p.records || typeof p.records !== 'object') p.records = {};
    return p;
  } catch {
    return fresh();
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 保存できない環境 */
  }
}

/** 日付が変わっていたら、今日のミッションに入れ替える */
export function refreshMissions(p: Progress, now = new Date()): void {
  const day = dayKey(now);
  if (p.missions?.day !== day) p.missions = freshMissions(day);
}

export function missionText(id: string, day: string): string {
  return MISSIONS.find((m) => m.id === id)?.text(day) ?? id;
}

export function missionGoal(id: string): number {
  return MISSIONS.find((m) => m.id === id)?.goal ?? 1;
}

/** 新しく手に入れた称号を調べて、コインを渡す */
export function checkTitles(p: Progress, w: Wallet): TitleDef[] {
  const got: TitleDef[] = [];
  for (const t of TITLES) {
    if (p.titles.includes(t.id) || !t.check(p, w)) continue;
    p.titles.push(t.id);
    w.coins += t.coins;
    got.push(t);
  }
  return got;
}

/** 1試合の結果を記録する。終わったミッション・手に入れた称号と、もらったコインを返す */
export function recordMatch(p: Progress, w: Wallet, s: MatchStats, now = new Date()): { missions: string[]; bonus: boolean; titles: TitleDef[]; coins: number } {
  refreshMissions(p, now);
  const before = w.coins;
  const r = (p.records[s.charId] ??= { matches: 0, wins: 0, kos: 0, falls: 0, dealt: 0 });
  r.matches++;
  if (s.won) r.wins++;
  r.kos += s.kos;
  r.falls += s.falls;
  r.dealt += Math.round(s.dealt);
  const t = p.totals;
  t.matches++;
  if (s.won) t.wins++;
  t.kos += s.kos;
  t.throws += s.throws;
  t.taunts += s.taunts;
  t.specials += s.specials;
  t.items += s.items;
  const done: string[] = [];
  for (const m of p.missions.list) {
    if (m.done) continue;
    const def = MISSIONS.find((x) => x.id === m.id);
    if (!def) continue;
    m.progress = Math.min(def.goal, m.progress + def.add(s, p.missions.day));
    if (m.progress >= def.goal) {
      m.done = true;
      w.coins += MISSION_REWARD;
      done.push(def.text(p.missions.day));
    }
  }
  let bonus = false;
  if (!p.missions.bonus && p.missions.list.every((m) => m.done)) {
    p.missions.bonus = true;
    w.coins += MISSION_BONUS;
    bonus = true;
  }
  const titles = checkTitles(p, w);
  return { missions: done, bonus, titles, coins: w.coins - before };
}
