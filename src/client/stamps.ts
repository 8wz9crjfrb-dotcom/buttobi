// スタンプ（DM・オンラインの待機画面・結果画面・観戦中に送れる）。
// キャラの似顔絵（3D から描いた顔。表情を指定）に、記号や小物の絵と、会話で使えるひとことを重ねる。
// 番号で送るので、並びを変えない・新しいものは最後に足す（数は PIC_STAMP_COUNT と合わせる）

import type { FaceKind, FaceMouth } from './fighterModel';

type Face = [FaceKind, FaceMouth];

interface PicStampDef {
  /** ひとこと */
  text: string;
  /** 似顔絵のキャラ（複数なら並べる） */
  chars: string[];
  face: Face;
  /** 台の色 */
  color: string;
  /** 重ねる絵（viewBox 0 0 100 100 の SVG の中身） */
  deco: string;
  /** 3B の職業（0 美容師・1 バンドマン・2 バーテンダー） */
  job?: number;
}

const W = 'stroke="#fff" stroke-width="3" stroke-linejoin="round"';
const SPARK = (x: number, y: number, s: number, c = '#ffd84a') =>
  `<path d="M${x} ${y - s}L${x + s * 0.3} ${y - s * 0.3}L${x + s} ${y}L${x + s * 0.3} ${y + s * 0.3}L${x} ${y + s}L${x - s * 0.3} ${y + s * 0.3}L${x - s} ${y}L${x - s * 0.3} ${y - s * 0.3}Z" fill="${c}"/>`;
const HEART = (x: number, y: number, s: number, c = '#ff4f8b') =>
  `<path d="M${x} ${y + s * 0.9}C${x - s * 1.3} ${y}${' '}${x - s * 0.9} ${y - s * 1.1} ${x} ${y - s * 0.35}C${x + s * 0.9} ${y - s * 1.1} ${x + s * 1.3} ${y} ${x} ${y + s * 0.9}Z" fill="${c}" ${W}/>`;
const DROP = (x: number, y: number, s: number) => `<path d="M${x} ${y - s}C${x + s * 0.8} ${y} ${x + s * 0.6} ${y + s * 0.8} ${x} ${y + s * 0.8}C${x - s * 0.6} ${y + s * 0.8} ${x - s * 0.8} ${y} ${x} ${y - s}Z" fill="#6ec8ff" ${W}/>`;

export const PIC_STAMPS: PicStampDef[] = [
  // 0 了解！：警備員が敬礼（きらり）
  { text: '了解！', chars: ['guard'], face: ['smug', 'smile'], color: '#3d6bff', deco: `${SPARK(82, 20, 11)}${SPARK(16, 30, 6)}` },
  // 1 ストップ！：警備員と大きな ×
  { text: 'ストップ！', chars: ['guard'], face: ['angry', 'open'], color: '#ff4a5a', deco: `<path d="M66 8L94 36M94 8L66 36" stroke="#fff" stroke-width="13" stroke-linecap="round"/><path d="M66 8L94 36M94 8L66 36" stroke="#ff2a3a" stroke-width="7" stroke-linecap="round"/>` },
  // 2 ？：ハッカーが首をかしげる
  { text: '？', chars: ['hacker'], face: ['look', 'line'], color: '#2fbf71', deco: `<text x="80" y="38" font-size="40" font-weight="900" text-anchor="middle" fill="#fff" stroke="#1b1f3b" stroke-width="3" paint-order="stroke">?</text>` },
  // 3 なるほど：AIエンジニアと電球
  { text: 'なるほど', chars: ['ai'], face: ['smug', 'smile'], color: '#7a5cff', deco: `<circle cx="80" cy="20" r="12" fill="#ffe27a" ${W}/><rect x="75" y="31" width="10" height="7" rx="2" fill="#c8ccd8" ${W}/><path d="M80 2V-2M64 8L61 5M96 8L99 5" stroke="#ffe27a" stroke-width="3" stroke-linecap="round"/>` },
  // 4 ありがとう！：配信者とハート
  { text: 'ありがとう！', chars: ['streamer'], face: ['happy', 'open'], color: '#ff6fae', deco: `${HEART(82, 18, 12)}${HEART(16, 26, 7, '#ffb3d1')}` },
  // 5 おはよう！：配信者と太陽
  { text: 'おはよう！', chars: ['streamer'], face: ['happy', 'open'], color: '#ffae2a', deco: `<circle cx="82" cy="20" r="11" fill="#ffd84a" ${W}/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M${82 + Math.cos((a * Math.PI) / 180) * 15} ${20 + Math.sin((a * Math.PI) / 180) * 15}L${82 + Math.cos((a * Math.PI) / 180) * 20} ${20 + Math.sin((a * Math.PI) / 180) * 20}" stroke="#ffd84a" stroke-width="3.5" stroke-linecap="round"/>`).join('')}` },
  // 6 ごめん！：データ泥棒と汗
  { text: 'ごめん！', chars: ['thief'], face: ['closed', 'line'], color: '#8a8fa8', deco: `${DROP(80, 22, 10)}${DROP(18, 30, 6)}` },
  // 7 今行く！：配達員とスピードの線
  { text: '今行く！', chars: ['courier'], face: ['happy', 'open'], color: '#22b07d', deco: `<path d="M4 24H24M0 36H18M6 48H22" stroke="#fff" stroke-width="5" stroke-linecap="round"/>${SPARK(84, 18, 8, '#fff')}` },
  // 8 笑：ドパガキが大笑い
  { text: '笑', chars: ['dopa'], face: ['happy', 'open'], color: '#ff8a3d', deco: `<text x="82" y="34" font-size="30" font-weight="900" text-anchor="middle" fill="#fff" stroke="#1b1f3b" stroke-width="3" paint-order="stroke">w</text><text x="16" y="28" font-size="20" font-weight="900" text-anchor="middle" fill="#fff" stroke="#1b1f3b" stroke-width="3" paint-order="stroke">w</text>` },
  // 9 つらい…：ガチャ廃人と雨雲
  { text: 'つらい…', chars: ['gacha'], face: ['hurt', 'open'], color: '#4a5378', deco: `<path d="M66 26a9 9 0 0 1 4-17a12 12 0 0 1 22 4a8 8 0 0 1-2 13Z" fill="#9aa3c2" ${W}/><path d="M72 32l-3 7M82 32l-3 7M91 32l-3 7" stroke="#6ec8ff" stroke-width="3" stroke-linecap="round"/>` },
  // 10 やったー！：ガチャ廃人と光るカプセル
  { text: 'やったー！', chars: ['gacha'], face: ['happy', 'open'], color: '#e0a800', deco: `<circle cx="82" cy="22" r="13" fill="#fff" ${W}/><path d="M69 22A13 13 0 0 1 95 22Z" fill="#ff4fa3"/><path d="M69 22H95" stroke="#1b1f3b" stroke-width="2.5"/>${SPARK(64, 8, 6)}${SPARK(98, 40, 5)}` },
  // 11 がんばれ！：トレーナーと炎
  { text: 'がんばれ！', chars: ['trainer'], face: ['angry', 'open'], color: '#ff5a2a', deco: `<path d="M82 4C90 14 96 20 94 30C92 38 86 42 82 42C76 42 70 38 70 30C70 24 74 20 76 16C78 22 80 24 82 24C82 16 80 10 82 4Z" fill="#ffb02e" ${W}/><path d="M82 24C86 28 88 32 86 36C84 39 80 39 78 36C77 33 79 30 82 24Z" fill="#fff4a8"/>` },
  // 12 おつかれ！：3Bがグラスで乾杯
  { text: 'おつかれ！', chars: ['threeb'], job: 2, face: ['happy', 'smile'], color: '#b05cff', deco: `<path d="M68 10H80L78 28H70Z" fill="#ffd84a" ${W} transform="rotate(-14 74 20)"/><path d="M84 10H96L94 28H86Z" fill="#ffd84a" ${W} transform="rotate(14 90 20)"/>${SPARK(82, 4, 5, '#fff')}` },
  // 13 ちょっと待って…：メンヘラが涙目
  { text: 'ちょっと待って…', chars: ['menhera'], face: ['panic', 'open'], color: '#ff7eb6', deco: `${DROP(78, 24, 8)}${HEART(90, 12, 6, '#ffd1e3')}` },
  // 14 おやすみ：メンヘラと月と Zzz
  { text: 'おやすみ', chars: ['menhera'], face: ['closed', 'line'], color: '#3a3f7a', deco: `<path d="M90 8A14 14 0 1 0 96 32A11 11 0 1 1 90 8Z" fill="#ffe27a" ${W}/><text x="14" y="26" font-size="16" font-weight="900" fill="#fff">Z</text><text x="4" y="40" font-size="11" font-weight="900" fill="#fff">z</text>` },
  // 15 GG！：みんなでいい試合
  { text: 'GG！', chars: ['guard', 'streamer', 'courier', 'menhera'], face: ['happy', 'open'], color: '#1b1f3b', deco: `${SPARK(10, 12, 7)}${SPARK(90, 12, 7)}${SPARK(50, 6, 5, '#fff')}` },
  // 16 いい感じ！：3B（美容師）がハサミできらり
  { text: 'いい感じ！', chars: ['threeb'], job: 0, face: ['smug', 'smile'], color: '#2fb5c8', deco: `<g stroke='#fff' stroke-width='2.5' fill='#c8ccd8'><circle cx='74' cy='30' r='6'/><circle cx='90' cy='30' r='6'/><path d='M77 25L94 6M87 25L70 6' stroke='#c8ccd8' stroke-width='5' stroke-linecap='round'/></g>${SPARK(20, 18, 8)}${SPARK(96, 46, 5, '#fff')}` },
  // 17 最高！：3B（バンドマン）と音符
  { text: '最高！', chars: ['threeb'], job: 1, face: ['happy', 'open'], color: '#e0364f', deco: `<g fill='#fff' ${W}><path d='M74 30V8L94 4V26' fill='none' stroke='#fff' stroke-width='4'/><ellipse cx='70' cy='31' rx='6' ry='5'/><ellipse cx='90' cy='27' rx='6' ry='5'/></g><g fill='#ffd84a'><path d='M14 34V16L24 14' fill='none' stroke='#ffd84a' stroke-width='3'/><ellipse cx='11' cy='35' rx='4' ry='3.4'/></g>` },
];

/** 最初から全員が持っているスタンプ（了解！・ありがとう！・ごめん！・GG！）。ほかはガチャで集める */
export const FREE_STAMPS = [0, 4, 6, 15];

/** 似顔絵を描く関数（main.ts で renderer.portrait をつなぐ） */
let portraitOf: (charId: string, face: Face, job?: number) => string = () => '';
export function setStampPortrait(fn: (charId: string, face: Face, job?: number) => string): void {
  portraitOf = fn;
}

/**
 * スタンプの HTML（DM の吹き出し・送るボタン・待機画面の表示で使う）。
 * tier = レア度（4 SR・5 SSR・6 UR）。同じ言葉でも、SSR は金の縁ときらめき、UR は虹色に光って動く
 */
/** rank = false なら左上の「SSR」「UR」の文字を出さない（チャットで送る・見るときは出さない） */
export function picStamp(i: number, tier = 4, rank = true): string {
  const s = PIC_STAMPS[i];
  if (!s) return '';
  const faces = s.chars.map((c) => `<img alt="" src="${portraitOf(c, s.face, s.job)}"/>`).join('');
  const t = tier >= 6 ? 6 : tier >= 5 ? 5 : 4;
  const shine = t >= 5 ? `<svg class="ps-shine" viewBox="0 0 100 100" aria-hidden="true"><path d="M12 6l2 5 5 2-5 2-2 5-2-5-5-2 5-2z M88 64l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="${t >= 6 ? '#fff' : '#fff3b0'}"/></svg>` : '';
  return `<span class="pic-stamp t${t} ${s.chars.length > 1 ? 'group' : ''}" style="--sc:${s.color}">${t >= 5 && rank ? `<i class="ps-rank">${t >= 6 ? 'UR' : 'SSR'}</i>` : ''}${shine}<span class="ps-faces">${faces}</span><svg class="ps-deco" viewBox="0 0 100 100" aria-hidden="true">${s.deco}</svg><b class="${[...s.text].length >= 7 ? 'long' : ''}">${s.text}</b></span>`;
}

/** レア度の名前 */
export function tierName(t: number): string {
  return t >= 6 ? 'UR' : t >= 5 ? 'SSR' : 'SR';
}
