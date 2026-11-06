// 設定（端末に保存）

import { CHARACTERS } from '../shared/characters';
import { STAGES } from '../shared/stages';
import { DEFAULT_RULES, type MatchRules } from '../shared/types';
import type { Quality } from './renderer';

export interface Settings {
  name: string;
  charId: string;
  btnSize: 'S' | 'M' | 'L';
  btnOpacity: 'low' | 'mid' | 'high';
  quality: Quality;
  tapJump: boolean;
  vibration: boolean;
  /** 画面左上にフレームレート（fps）を表示する */
  showFps: boolean;
  volume: number;
  /** BGMの音量 */
  bgmVolume: number;
  serverUrl: string;
  cpuCount: number;
  cpuLevel: number;
  stageId: string;
  rules: MatchRules;
}

const KEY = 'buttobi-settings-v1';

/** 公開している対戦サーバー（Cloudflare Workers）。別のサーバーを使うときは VITE_SERVER_URL か設定画面で変更できる */
const PUBLIC_SERVER_URL = 'wss://buttobi-server.8wz9crjfrb.workers.dev';

function defaultServerUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  const h = location.hostname;
  // 開発中（Mac で起動して同じ Wi-Fi の端末から開く）はローカルのサーバーにつなぐ
  if (h === 'localhost' || h === '127.0.0.1' || /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(h)) return `ws://${h}:8787`;
  return PUBLIC_SERVER_URL;
}

export function loadSettings(): Settings {
  const lowEnd = (navigator.hardwareConcurrency ?? 4) <= 4;
  const def: Settings = {
    name: '',
    charId: CHARACTERS[0].id,
    btnSize: 'M',
    btnOpacity: 'mid',
    quality: lowEnd ? 'low' : 'high',
    tapJump: true,
    vibration: true,
    showFps: false,
    volume: 0.7,
    bgmVolume: 0.5,
    serverUrl: defaultServerUrl(),
    cpuCount: 3,
    cpuLevel: 3,
    stageId: STAGES[0].id,
    rules: { ...DEFAULT_RULES },
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...def, ...JSON.parse(raw) } as Settings;
      if (!s.serverUrl) s.serverUrl = def.serverUrl;
      return s;
    }
  } catch {
    /* 保存領域が使えない場合は初期値 */
  }
  return def;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 保存できなくても続ける */
  }
}

export function applyUiSettings(s: Settings): void {
  const root = document.documentElement.style;
  root.setProperty('--btn-size', { S: '64px', M: '76px', L: '90px' }[s.btnSize]);
  root.setProperty('--btn-opacity', { low: '0.3', mid: '0.55', high: '0.8' }[s.btnOpacity]);
}
