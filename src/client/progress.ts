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
  /** 100人組手の自己ベスト（倒した数と、そのときの時間） */
  hordeBest?: { kos: number; frames: number; charId: string };
  /** トーナメントの成績（優勝・3位の回数） */
  /** トーナメント：優勝・3位・準優勝の回数（準優勝はあとから足したので、ないこともある） */
  tour?: { wins: number; third: number; second?: number };
  /** ルール（モード）ごとの勝ち数（称号用） */
  modeWins?: Record<string, number>;
  /** 勝敗予想の成績（予想した回数・当たった回数・予想でもらったコイン） */
  pred?: { n: number; hit: number; coins: number };
  /** メニューの赤い点：最後にその画面を開いたときの状態（開くと赤い点が消える） */
  seen?: { coins: number; missionDay: string; missionsDone: number; titles: number };
}

// ---------------------------------------------------------------- メニューの赤い点（一度見ると消える）
function seenOf(p: Progress): NonNullable<Progress['seen']> {
  return (p.seen ??= { coins: 0, missionDay: '', missionsDone: 0, titles: 0 });
}

/** ガチャ：前に見たときよりコインが増えていて、1回引ける */
export function gachaBadge(p: Progress, w: Wallet, cost: number): boolean {
  return w.coins >= cost && w.coins > (p.seen?.coins ?? 0);
}

/** 戦績・ミッション：今日のミッションをまだ見ていない／ミッションを達成した／称号が増えた */
export function recordsBadge(p: Progress): boolean {
  const s = p.seen;
  const done = p.missions.list.filter((m) => m.done).length;
  return !s || s.missionDay !== p.missions.day || done > s.missionsDone || p.titles.length > s.titles;
}

/** ガチャ画面を開いた */
export function markGachaSeen(p: Progress, w: Wallet): void {
  seenOf(p).coins = w.coins;
}

/** 戦績・ミッション画面を開いた */
export function markRecordsSeen(p: Progress): void {
  const s = seenOf(p);
  s.missionDay = p.missions.day;
  s.missionsDone = p.missions.list.filter((m) => m.done).length;
  s.titles = p.titles.length;
}

// ---------------------------------------------------------------- 100人組手
/** 敵のCPUの強さ（はじめ）と、何人倒すごとに強くなるか */
export const HORDE_CPU_LEVEL = 2;
export const HORDE_LEVEL_STEP = 25;
/** 100人組手のコイン：10人ごとに5コイン、全員倒すと100コイン追加 */
export function hordeReward(kos: number, total: number): number {
  return Math.floor(kos / 10) * 5 + (kos >= total ? 100 : 0);
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
  /** ルール（モード）。100人組手は入れない */
  mode?: string;
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

/** 名前を変えた称号（前の名前 → 今の名前）。プロフィールに前の名前を設定していた人も、そのまま表示できるように */
export const RENAMED_TITLES: Record<string, string> = { ぶっとびの王: 'トバセの王', ぶっとび中毒: 'トバセ中毒' };

/** 称号の種類（戦績・ミッションの称号の画面で、この順にまとめて並べる） */
export const TITLE_GROUPS: { name: string; match: (id: string) => boolean }[] = [
  { name: '勝利・撃墜', match: (id) => /^(win|ko|match)\d/.test(id) },
  { name: 'わざ・プレイ', match: (id) => /^(throw|taunt|item|special)\d/.test(id) },
  { name: 'ルール別', match: (id) => id.startsWith('mode-') },
  { name: '100人組手', match: (id) => id.startsWith('horde') },
  { name: 'トーナメント・予想', match: (id) => /^(tour|pred)\d/.test(id) },
  { name: '衣装・ログイン', match: (id) => /^(costume|login)/.test(id) },
  { name: 'キャラマスター', match: (id) => id.startsWith('master-') },
];

export const TITLES: TitleDef[] = [
  { id: 'win1', name: 'はじめての勝利', cond: '1回勝つ', coins: 50, check: (p) => p.totals.wins >= 1 },
  { id: 'win10', name: '駆け出しファイター', cond: '通算10勝', coins: 100, check: (p) => p.totals.wins >= 10 },
  { id: 'win50', name: '歴戦の勇者', cond: '通算50勝', coins: 200, check: (p) => p.totals.wins >= 50 },
  { id: 'win100', name: 'トバセの王', cond: '通算100勝', coins: 500, check: (p) => p.totals.wins >= 100 },
  { id: 'ko50', name: '撃墜王', cond: '通算50撃墜', coins: 150, check: (p) => p.totals.kos >= 50 },
  { id: 'throw30', name: '投げ名人', cond: '投げを30回決める', coins: 100, check: (p) => p.totals.throws >= 30 },
  { id: 'taunt20', name: '目立ちたがり', cond: 'アピールを20回する', coins: 50, check: (p) => p.totals.taunts >= 20 },
  { id: 'item30', name: 'アイテムハンター', cond: 'アイテムを30回拾う', coins: 100, check: (p) => p.totals.items >= 30 },
  { id: 'costume12', name: 'おしゃれさん', cond: '衣装を12着集める', coins: 150, check: (_p, w) => w.owned.length >= 12 },
  { id: 'costumeAll', name: 'コンプリート', cond: '衣装を全部集める', coins: 500, check: (_p, w) => GACHA_COSTUMES.every((c) => w.owned.includes(c.id)) },
  { id: 'horde30', name: '組手の達人', cond: '100人組手で30人倒す', coins: 100, check: (p) => (p.hordeBest?.kos ?? 0) >= 30 },
  { id: 'horde100', name: '百人斬り', cond: '100人組手をクリアする', coins: 300, check: (p) => (p.hordeBest?.kos ?? 0) >= 100 },
  { id: 'tour1', name: '初優勝', cond: 'トーナメントで1回優勝する', coins: 100, check: (p) => (p.tour?.wins ?? 0) >= 1 },
  { id: 'tour3', name: 'トーナメント王者', cond: 'トーナメントで3回優勝する', coins: 300, check: (p) => (p.tour?.wins ?? 0) >= 3 },
  { id: 'pred10', name: '予想名人', cond: '勝敗予想を10回当てる', coins: 100, check: (p) => (p.pred?.hit ?? 0) >= 10 },
  { id: 'pred300', name: '予想王', cond: '勝敗予想で合計300コインもらう', coins: 200, check: (p) => (p.pred?.coins ?? 0) >= 300 },
  { id: 'login7', name: '皆勤賞', cond: '7日連続でログイン', coins: 100, check: (_p, w) => w.streak >= 7 },
  // 積み重ね
  { id: 'win300', name: '伝説のファイター', cond: '通算300勝', coins: 800, check: (p) => p.totals.wins >= 300 },
  { id: 'ko200', name: '撃墜マシーン', cond: '通算200撃墜', coins: 300, check: (p) => p.totals.kos >= 200 },
  { id: 'match1000', name: 'トバセ中毒', cond: '1000試合する', coins: 500, check: (p) => p.totals.matches >= 1000 },
  { id: 'special500', name: '必殺技マニア', cond: '必殺技を500回使う', coins: 150, check: (p) => p.totals.specials >= 500 },
  { id: 'special1000', name: '必殺技の達人', cond: '必殺技を1000回使う', coins: 300, check: (p) => p.totals.specials >= 1000 },
  { id: 'special5000', name: '必殺技の鬼', cond: '必殺技を5000回使う', coins: 500, check: (p) => p.totals.specials >= 5000 },
  { id: 'special10000', name: '必殺技の神', cond: '必殺技を10000回使う', coins: 1000, check: (p) => p.totals.specials >= 10000 },
  { id: 'costume24', name: '着せ替え上手', cond: '衣装を24着集める', coins: 300, check: (_p, w) => w.owned.length >= 24 },
  { id: 'login30', name: '常連さん', cond: '30日連続でログイン', coins: 300, check: (_p, w) => (w.run ?? 0) >= 30 },
  // ルール（モード）別
  ...(
    [
      ['ball', 'ゴールハンター', '玉入れ'],
      ['crown', '王様', '王冠うばい'],
      ['vault', '金庫番', '金庫まもり'],
      ['bounty', '賞金稼ぎ', '賞金首'],
      ['coins', '大富豪', 'コイン集め'],
      ['area', '陣取り名人', 'エリアバトル'],
    ] as const
  ).map(([mode, name, label]) => ({
    id: `mode-${mode}`,
    name,
    cond: `${label}で10勝`,
    coins: 150,
    check: (p: Progress) => (p.modeWins?.[mode] ?? 0) >= 10,
  })),
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
  if (s.won && s.mode) (p.modeWins ??= {})[s.mode] = (p.modeWins[s.mode] ?? 0) + 1;
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
