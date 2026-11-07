// タッチ操作のボタン配置（左利き・ボタンを好きな位置に動かす）

import type { Settings } from './settings';

/** 設定どおりにボタンとスティックを並べる */
export function applyTouchLayout(s: Pick<Settings, 'leftHanded' | 'btnPos'>): void {
  const touch = document.getElementById('touch');
  const box = document.getElementById('buttons');
  if (!touch || !box) return;
  touch.classList.toggle('left-handed', s.leftHanded);
  const custom = Object.keys(s.btnPos).length > 0;
  box.classList.toggle('custom', custom);
  document.querySelectorAll<HTMLElement>('.pad-btn').forEach((el) => {
    const p = s.btnPos[el.id];
    if (custom && p) {
      el.style.left = `${(p.x * 100).toFixed(2)}%`;
      el.style.top = `${(p.y * 100).toFixed(2)}%`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    } else {
      el.style.left = el.style.top = el.style.right = el.style.bottom = '';
    }
  });
}

/** 今の見た目の位置（ボタンの中心。画面に対する割合）を読む */
export function currentButtonPositions(): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const w = window.innerWidth;
  const h = window.innerHeight;
  document.querySelectorAll<HTMLElement>('.pad-btn').forEach((el) => {
    const r = el.getBoundingClientRect();
    out[el.id] = { x: (r.left + r.width / 2) / w, y: (r.top + r.height / 2) / h };
  });
  return out;
}
