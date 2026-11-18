// キャラクター定義（職業がそのままキャラクター）

import { isTwoTeam, type MatchSetup } from './types';
import { ITEMS, SPEEDUP } from './moves';

export interface CharacterDef {
  id: string;
  name: string;
  /** タイプの説明 */
  role: string;
  /** キャラ選択画面の説明文 */
  desc: string;
  /** 基本の色（衣装で変わる） */
  color: number;
  accent: number;
  walkSpeed: number;
  runSpeed: number;
  airSpeed: number;
  airAccel: number;
  jumpV: number;
  airJumpV: number;
  airJumps: number;
  gravity: number;
  fallMax: number;
  /** 重さ（大きいほど飛びにくい） */
  weight: number;
  /** 攻撃力の倍率 */
  dmgMul: number;
  /** ふっとばし力の倍率 */
  kbMul: number;
  /** 技の発生・後隙の倍率（大きいほど遅い） */
  frameMul: number;
  /** 体の大きさ（当たり判定と見た目） */
  scale: number;
  /** 必殺技の名前（そのまま・横・下・上） */
  specialNames: { n: string; s: string; d: string; u: string };
  /** キャラごとの特性（常に効いている能力） */
  trait: { name: string; desc: string };
}

/** すべてのキャラ（まだ公開していないキャラも含む） */
export const ALL_CHARACTERS: CharacterDef[] = [
  {
    id: 'guard',
    name: 'データセンター警備員',
    role: '盾役・重量級',
    desc: 'サーバーを守るたたき上げの警備員。重くて飛ばされにくい。',
    color: 0x2c3e75,
    accent: 0xffd23f,
    walkSpeed: 2.9,
    runSpeed: 6.4,
    airSpeed: 4.9,
    airAccel: 32,
    jumpV: 12.6,
    airJumpV: 11.6,
    airJumps: 1,
    gravity: 36,
    fallMax: 15,
    weight: 1.35,
    dmgMul: 1.02,
    kbMul: 1.1,
    frameMul: 1.15,
    scale: 1.1,
    specialNames: { n: '利用規約を読み上げる', s: '物理ファイアウォール', d: 'クレーム対応', u: '非常口ダッシュ' },
    trait: { name: '巡回中', desc: 'ガード（シールド）の耐久が1.5倍で、回復も早い。' },
  },
  {
    id: 'hacker',
    name: 'ハッカー',
    role: '火力・軽量級',
    desc: 'ハッキングで大ダメージ。そのかわり打たれ弱い。',
    color: 0x24242c,
    accent: 0x39ff88,
    walkSpeed: 3.4,
    runSpeed: 7.4,
    airSpeed: 5.6,
    airAccel: 42,
    jumpV: 13.0,
    airJumpV: 12.0,
    airJumps: 1,
    gravity: 33,
    fallMax: 13.5,
    weight: 0.85,
    dmgMul: 1.12,
    kbMul: 1.1,
    frameMul: 1.0,
    scale: 0.95,
    specialNames: { n: 'DDoS', s: 'Ctrl+Z', d: 'キャッシュ', u: 'ポップアップ広告' },
    trait: { name: 'ゼロデイ', desc: '相手のガードを削る力が2倍。' },
  },
  {
    id: 'thief',
    name: 'データ泥棒',
    role: '妨害・スピード',
    desc: 'すばやく動き、ウイルスでじわじわ削る。',
    color: 0x3b2a5c,
    accent: 0xff4fa3,
    walkSpeed: 4.4,
    runSpeed: 9.8,
    airSpeed: 6.4,
    airAccel: 50,
    jumpV: 13.8,
    airJumpV: 12.6,
    airJumps: 1,
    gravity: 38,
    fallMax: 16,
    weight: 0.88,
    dmgMul: 0.9,
    kbMul: 0.92,
    frameMul: 0.82,
    scale: 0.92,
    specialNames: { n: 'マルウェア', s: 'スクショ', d: 'なりすまし', u: '炎上させる' },
    trait: { name: '抜き取り', desc: '攻撃を当てると、与えたダメージの1/5だけ自分のダメージ%が回復する。' },
  },
  {
    id: 'streamer',
    name: '配信者',
    role: '邪魔・牽制',
    desc: 'なかまを盛り上げ、相手を眠らせる。標準的な性能。',
    color: 0xff7eb6,
    accent: 0x7ef0d0,
    walkSpeed: 3.6,
    runSpeed: 7.6,
    airSpeed: 5.8,
    airAccel: 42,
    jumpV: 13.2,
    airJumpV: 12.2,
    airJumps: 1,
    gravity: 32,
    fallMax: 13,
    weight: 1.0,
    dmgMul: 1.08,
    kbMul: 1.0,
    frameMul: 1.0,
    scale: 1.0,
    specialNames: { n: '投げ銭', s: '切り抜き', d: '強制アップデート', u: 'スパチャ読み' },
    trait: { name: 'バズり', desc: '撃墜するたびに攻撃力が上がる（最大3段階。自分が落ちると元に戻る）。' },
  },
  {
    id: 'dopa',
    name: 'ドパガキ',
    role: '手数・短期集中',
    desc: 'ショート動画に脳を焼かれた子ども。とにかく手数が多い。',
    color: 0xb6ff3b,
    accent: 0xff7a1a,
    walkSpeed: 3.9,
    runSpeed: 8.8,
    airSpeed: 6.0,
    airAccel: 46,
    jumpV: 13.6,
    airJumpV: 12.4,
    airJumps: 1,
    gravity: 35,
    fallMax: 14.5,
    weight: 0.88,
    dmgMul: 0.98,
    kbMul: 1.0,
    frameMul: 0.85,
    scale: 0.88,
    specialNames: { n: '倍速再生', s: '無限スクロール', d: '通知爆撃', u: '次の動画へ' },
    trait: { name: '飽き性', desc: '違う技を続けて出すほど威力が上がる（最大1.3倍）。同じ技を出すと元に戻る。' },
  },
  {
    id: 'gacha',
    name: 'ガチャ廃人',
    role: '運まかせ',
    desc: '人生をガチャにささげた人。当たれば最強、外れれば自爆。',
    color: 0x5a5f8f,
    accent: 0xffd23f,
    walkSpeed: 3.4,
    runSpeed: 7.2,
    airSpeed: 5.6,
    airAccel: 40,
    jumpV: 13.0,
    airJumpV: 12.0,
    airJumps: 1,
    gravity: 34,
    fallMax: 14,
    weight: 1.08,
    dmgMul: 1.13,
    kbMul: 1.06,
    frameMul: 1.0,
    scale: 1.0,
    specialNames: { n: '10連ガチャ', s: '単発ガチャ', d: '課金', u: '無償石を配る' },
    trait: { name: '天井', desc: 'ガチャの外れが6回続くと、次は必ず大当たり。' },
  },
  {
    id: 'courier',
    name: 'フードデリバリー配達員',
    role: '最速・機動力',
    desc: 'ネオン街を自転車でかけぬける。とにかく速い。',
    color: 0x2fbf71,
    accent: 0xffffff,
    walkSpeed: 4.6,
    runSpeed: 10.4,
    airSpeed: 6.2,
    airAccel: 48,
    jumpV: 13.4,
    airJumpV: 12.2,
    airJumps: 1,
    gravity: 36,
    fallMax: 15,
    weight: 1.04,
    dmgMul: 1.06,
    kbMul: 1.0,
    frameMul: 0.95,
    scale: 1.0,
    specialNames: { n: '配達バッグ投げ', s: '自転車', d: '置き配', u: '立ちこぎジャンプ' },
    trait: { name: '時間指定', desc: '走り続けるほど速くなる。' },
  },
  {
    id: 'ai',
    name: 'AIエンジニア',
    role: 'トリッキー',
    desc: 'AIアシスタントを連れたエンジニア。AIを使ってトリッキーに戦う。',
    color: 0xe8ecf4,
    accent: 0x4fd8ff,
    walkSpeed: 3.5,
    runSpeed: 7.4,
    airSpeed: 5.6,
    airAccel: 42,
    jumpV: 13.0,
    airJumpV: 12.0,
    airJumps: 1,
    gravity: 33,
    fallMax: 13.5,
    weight: 1.0,
    dmgMul: 1.0,
    kbMul: 1.0,
    frameMul: 1.0,
    scale: 1.0,
    specialNames: { n: '推論', s: '学習', d: 'エージェント起動', u: 'API呼び出し' },
    trait: { name: '学習データ', desc: '同じ相手から攻撃を受けるほど、その相手からのダメージが減る。' },
  },
  {
    id: 'trainer',
    name: 'パーソナルトレーナー',
    role: 'パワー・つかみ',
    desc: '鍛え上げた筋肉で、つかんで投げて叩きつける。重くて飛ばされにくい。',
    color: 0xff6a3d,
    accent: 0x1f1f2a,
    walkSpeed: 3.4,
    runSpeed: 7.0,
    airSpeed: 5.0,
    airAccel: 38,
    jumpV: 12.6,
    airJumpV: 11.4,
    airJumps: 1,
    gravity: 36,
    fallMax: 14.5,
    weight: 1.12,
    dmgMul: 1.04,
    kbMul: 1.04,
    frameMul: 1.06,
    scale: 1.08,
    specialNames: { n: 'ダンベルカール', s: 'タックル', d: 'プロテイン', u: 'マッスルジャンプ' },
    trait: { name: '筋肉は裏切らない', desc: '投げのダメージが1.3倍。体が重く、飛ばされにくい。' },
  },
  {
    id: 'threeb',
    name: '3B',
    role: 'ジョブチェンジ',
    desc: '美容師・バンドマン・バーテンダーを下Bで切り替える。仕事ごとに必殺技と動きが変わる。',
    color: 0xc77dff,
    accent: 0x1a1a22,
    // ここの数値は美容師のとき（バンドマン・バーテンダーは THREEB_JOBS で上書き）
    walkSpeed: 4.0,
    runSpeed: 8.6,
    airSpeed: 6.0,
    airAccel: 46,
    jumpV: 13.4,
    airJumpV: 12.2,
    airJumps: 1,
    gravity: 34,
    fallMax: 14,
    weight: 0.98,
    dmgMul: 0.98,
    kbMul: 1.0,
    frameMul: 0.92,
    scale: 1.0,
    // 選択画面では短く（くわしい名前は長押しの説明に）
    specialNames: { n: 'ハサミ／ギター／ボトル', s: 'ドライヤー／ダイブ／スライド', d: 'ジョブチェンジ', u: 'スプレー／アンコール／シェイカー' },
    trait: { name: '早着替え', desc: 'ジョブチェンジしてから約4秒間、攻撃力が1.25倍。' },
  },
  {
    // まだ公開していない（URL に ?preview を付けたときだけ選べる）
    id: 'menhera',
    name: 'メンヘラ',
    role: '粘着・一点集中',
    desc: '重い愛で相手に絡みつく、かまってちゃん。放っておかれるほど強くなる。',
    color: 0xff7ab8,
    accent: 0x1a1420,
    walkSpeed: 3.8,
    runSpeed: 8.2,
    airSpeed: 5.8,
    airAccel: 44,
    jumpV: 13.4,
    airJumpV: 12.2,
    airJumps: 1,
    gravity: 34,
    fallMax: 14,
    weight: 0.96,
    dmgMul: 1.035,
    kbMul: 1.0,
    frameMul: 0.92,
    scale: 0.96,
    specialNames: { n: '赤い糸', s: '鬼電', d: '泣き落とし', u: 'ハート風船' },
    trait: { name: 'かまってちゃん', desc: '約3秒、相手に攻撃を当てないと「病みモード」になり、攻撃力1.25倍・ふっとばし力1.1倍。攻撃を当てると「デレモード」に戻り、約3秒だけ移動が少し速くなる（移動アップは一度出ると約7秒は出ない）。' },
  },
];

/** テスト表示（まだ公開していないキャラなどを出す）を覚えておく場所 */
export const PREVIEW_KEY = 'buttobi-preview-v1';
/**
 * まだ公開していないキャラ・ステージを、確認のために出すか。
 * URL に ?preview を付けて開くか、設定画面の見出し「設定」を7回たたくとオンになり、端末に覚える（?preview=off か、もう一度7回でオフ）。
 * サーバー・テストでは出さない
 */
function readPreview(): boolean {
  const g = globalThis as { location?: { search?: string }; localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } };
  const q = g.location?.search ?? '';
  try {
    if (/[?&]preview=off/.test(q)) {
      g.localStorage?.removeItem(PREVIEW_KEY);
      return false;
    }
    if (/[?&]preview(=|&|$)/.test(q)) {
      g.localStorage?.setItem(PREVIEW_KEY, '1');
      return true;
    }
    return g.localStorage?.getItem(PREVIEW_KEY) === '1';
  } catch {
    return /[?&]preview(=|&|$)/.test(q);
  }
}
export const PREVIEW = readPreview();
/** まだ公開していないキャラ */
export const HIDDEN_CHARS = ['menhera'];
/** 選べるキャラ（ふだんは公開しているキャラだけ） */
export const CHARACTERS: CharacterDef[] = PREVIEW ? ALL_CHARACTERS : ALL_CHARACTERS.filter((c) => !HIDDEN_CHARS.includes(c.id));

/** 3B の仕事ごとの体の性能（美容師は基本のまま。バンドマンは遅くて重い一撃、バーテンダーはその中間） */
const THREEB_JOBS: Partial<CharacterDef>[] = [
  {},
  { walkSpeed: 3.4, runSpeed: 7.2, airSpeed: 5.2, jumpV: 12.8, weight: 1.1, dmgMul: 1.1, kbMul: 1.1, frameMul: 1.06 },
  { walkSpeed: 3.7, runSpeed: 7.9, airSpeed: 5.6, jumpV: 13.1, weight: 1.02, dmgMul: 1.05, kbMul: 1.04, frameMul: 1.0 },
];
const threebDefs: CharacterDef[] = [];

/** 3B の、その仕事のときの性能（id は 'threeb' のまま） */
export function threebDef(job: number): CharacterDef {
  const j = ((job % 3) + 3) % 3;
  if (!threebDefs[j]) threebDefs[j] = { ...CHARACTERS.find((c) => c.id === 'threeb')!, ...THREEB_JOBS[j] };
  return threebDefs[j];
}

export function getCharacter(id: string): CharacterDef {
  return ALL_CHARACTERS.find((c) => c.id === id) ?? ALL_CHARACTERS[0];
}

/** プレイヤー番号ごとの色（頭上の目印・HUDに使う） */
export const SLOT_COLORS = [0xff5a5a, 0x4f9dff, 0xffd23f, 0x4fd18b, 0xc77dff, 0xff9f43];

/** チーム戦のチームの色と名前（赤・青・緑・黄） */
export const TEAM_COLORS = [0xff5a5a, 0x4f9dff, 0x4fd18b, 0xffd23f];
export const TEAM_NAMES = ['赤', '青', '緑', '黄'];
/** 100人組手の敵の色 */
export const HORDE_COLOR = 0x9aa3ad;

/** 選手の色。チーム戦ならチームの色、100人組手の敵は灰色 */
export function playerColor(setup: MatchSetup | null | undefined, slot: number): number {
  const rules = setup?.rules;
  const p = setup?.players.find((x) => x.slot === slot);
  if (rules?.horde && p) return setup!.players[0] === p ? SLOT_COLORS[0] : HORDE_COLOR;
  // 玉入れはいつも赤と青の2チーム（チーム戦でなければ順番に赤・青。sim.ts と同じ決め方）
  if (rules && isTwoTeam(rules.mode) && p) return TEAM_COLORS[(rules.teams ? p.team ?? setup!.players.indexOf(p) : setup!.players.indexOf(p)) % 2];
  if (rules?.teams && p) return TEAM_COLORS[(p.team ?? 0) % TEAM_COLORS.length];
  return SLOT_COLORS[slot % SLOT_COLORS.length];
}

/** 玉入れのチーム（0 = 赤、1 = 青）。sim.ts と同じ決め方 */
export function ballTeamOf(setup: MatchSetup, slot: number): number {
  const i = setup.players.findIndex((p) => p.slot === slot);
  const p = setup.players[i];
  return ((setup.rules.teams ? p?.team ?? i : i) % 2 + 2) % 2;
}

/** エリアバトルのゲージの色（チーム戦はチームの色、個人戦はその人の色）。key はチーム番号または slot */
export function areaColor(setup: MatchSetup | null | undefined, key: number): number {
  if (setup?.rules.teams) return TEAM_COLORS[key % TEAM_COLORS.length];
  return playerColor(setup, key);
}

/** エリアバトルのゲージの名前（チーム戦は「赤チーム」、個人戦はプレイヤー名） */
export function areaName(setup: MatchSetup | null | undefined, key: number): string {
  if (setup?.rules.teams) return `${TEAM_NAMES[key % TEAM_NAMES.length]}チーム`;
  return setup?.players.find((p) => p.slot === key)?.name ?? '';
}

/** キャラ選択画面で、必殺技を長押ししたときに出す説明（数値は moves.ts・sim.ts の設定どおり） */
export const SPECIAL_DESCS: Record<string, { n: string; s: string; d: string; u: string }> = {
  guard: {
    n: '「利用規約」の看板をゆっくり前へ飛ばす。足は遅いが、当たった相手はふつうの技の約2倍長くひるむ。撃ったあと約0.7秒は撃てない。',
    s: '目の前に燃える壁を出す（約1.3秒）。壁は相手の飛び道具を消し、触れた相手を小さくはじき飛ばす（1枚の壁につき1人1回。ガード中の相手は押し返すだけ）。使ったあと約1.5秒は使えない。',
    d: '構え（約0.5秒）の間に攻撃されると、受けたダメージの1.3倍（最低8%）で相手に返す。',
    u: '斜め上へ突進して戻る復帰技。使ったあとは着地するまで無防備。終わってから約0.7秒は使えない。',
  },
  hacker: {
    n: '小さな弾をすばやく3連射する。1発は軽いが、離れた相手を削るのに便利。撃ったあと約1.5秒は撃てない。',
    s: '約2秒前にいた場所へ一瞬で戻り、その間に受けたダメージの半分を消す。空中でも使え、ふっとばされたあとの復帰やピンチの立て直しに使える。使ったあと約6秒は使えない。',
    d: '少し時間をかけて足元に罠を置く（1個まで、約10秒）。置いてから0.5秒後から、相手が触れると爆発して上へ大きく飛ばす（%が高い相手なら撃墜も狙える）。爆発したあと約2.5秒は置き直せない。',
    u: '足元に広告ウィンドウを出して上昇する。ウィンドウはしばらく残り、上に乗れる。',
  },
  thief: {
    n: 'マルウェアを飛ばす。当たった相手は約3秒間、少しずつダメージを受け続ける。',
    s: 'フラッシュとともに前へ高速で突き抜けて攻撃する。使ったあと約1秒は使えない。',
    d: 'いちばん近い相手（7m以内）と位置を入れ替える。入れ替えられた相手は約0.3秒固まる。崖ぎわで使うと相手を場外へ送れる。使ったあと約4秒は使えない。',
    u: '炎をまとって上昇する復帰技。何度も当たる。使ったあとは着地するまで無防備。',
  },
  streamer: {
    n: 'コインを山なりに投げる（少しゆっくり飛ぶ）。高い所や段差の上の相手に届く。投げたあと約1秒は投げられない。',
    s: '少し前（3m）へ瞬間移動して斬る。間合いを一気に詰められる。使ったあと約1秒は使えない。',
    d: '周りの地上の相手を眠らせて動けなくする（相手のダメージ%が高いほど長く、最大約1.7秒）。眠っている相手は1.2倍ふっとぶので、撃墜のチャンス。空中の相手には効かず、軽くはじくだけ。使ったあと約2.5秒は使えない。',
    u: '上昇しながら、周りにお礼のハートを飛ばす。使ったあとは着地するまで無防備。',
  },
  dopa: {
    n: '約7秒間、動きと攻撃が速くなる。効果が切れてから約5.5秒は使えない。',
    s: '横へ滑りながら攻撃。Bを押し直すと最大3回まで続けられ、3回目は大きくふっとばす。終わったあと約1秒は使えない。',
    d: '周り（4.5m以内）の相手にダメージを与えて、自分のほうへ引き寄せる。ガード中の相手には効かない。使ったあと約3秒は使えない。',
    u: '上へ高速で滑り上がる復帰技。途中でもう一度Bを押すと方向転換できる。使ったあとは着地するまで無防備。',
  },
  gacha: {
    n: '毎回ランダム。SSR（6%）：周りを大爆発／SR（14%）：金の弾3発／R（28%）：金の弾1発／N（29%）：石1発／回復（5%）：自分の%が15減る／爆死（18%）：自分が4%受けて少し動けなくなる。',
    s: '前へ殴りかかる。4回に1回ほど大当たりになり、威力2.5倍の超強力な一撃になる（撃墜の切り札）。使ったあと約1秒は使えない。',
    d: '自分のダメージ%が8増える代わりに、約6秒間、攻撃力1.3倍・ふっとばし力1.15倍。効果中は使っても何も起きない。',
    u: '上昇しながら、上から石を降らせる。使ったあとは着地するまで無防備で、着地してから約0.4秒は使えない。',
  },
  courier: {
    n: '配達バッグを投げる。しばらく進むと戻ってくるので、行きと帰りの2回当てられる。投げたあと約0.75秒は投げられない。',
    s: '自転車に乗る（約4秒、地上でのみ）。速く走れて、ぶつかった相手にダメージ（走り続けるほど強くふっとばす）。自転車ごとジャンプもできる。弱い攻撃を受けても少し減速するだけで降りない（受けたダメージが合計10%をこえるか、強い攻撃を受けると降りる）。攻撃・必殺技・ガードで降りる。降りてから約2秒は乗れない。',
    d: '拾うと7%回復するお弁当を置く（1個まで、約10秒）。相手も拾える。',
    u: '自転車ごと大ジャンプする復帰技。使ったあとは着地するまで無防備。',
  },
  trainer: {
    n: 'Bを押し続けると溜めて、離すと殴る（最大約1秒、威力最大1.8倍）。空中でも出せる。',
    s: '前へ突進して、当たった相手をつかむ。ガード中の相手もつかめる。つかんだ後は投げ・つかみ攻撃ができる。空中ではつかまずに当たるだけ。使ったあと約1秒は使えない。',
    d: 'プロテインを飲み、約5秒間、攻撃を受けてもひるまなくなる（ダメージは0.85倍。とても強いふっとばしは受ける）。次に飲めるまで約15秒。',
    u: '飛び上がりながら相手をつかみ、そのまま真下へ落ちて地面に叩きつける復帰技。使ったあとは着地するまで無防備。',
  },
  threeb: {
    n: '【美容師：シザーラッシュ】ハサミの連続カット。Bを連打すると2回まで続き、最後の一撃でふっとばす（終わったあと約1秒は使えない）。【バンドマン：爆音ソロ】ギターをかき鳴らし、自分の周り全方向に音の衝撃（近くだけ）。Bを押し続けると溜まる。【バーテンダー：フレアボトル】ボトルで殴る。当たった相手は約2.5秒、左右の操作が逆になる。',
    s: '【美容師：ブローアップ】ドライヤーの熱風を当てながら踏み込む連続ヒット。【バンドマン：ステージダイブ】前へ飛び込んで体当たり。当たると相手を踏み台に跳ね上がる。【バーテンダー：スライド】低く滑り込む足払い（地上のみ）。地上の相手を長くひるませる。どの仕事の横Bも、使ったあと約1秒は使えない。',
    d: '美容師→バンドマン→バーテンダーの順に着替える。回る瞬間に近くの相手へ軽い一撃。着替えたあと約1.3秒は着替えられない。着替えてから約4秒は攻撃力1.25倍。',
    u: '【美容師：スプレーターン】スプレーを噴きながら回転して上昇、周りに連続ヒット。【バンドマン：アンコール】ギターを振り上げて高く跳ぶ。【バーテンダー：シェイカーターン】シェイカーを振りながら回転して上昇。どれも使ったあとは着地するまで無防備。',
  },
  ai: {
    n: 'いちばん近い相手をゆっくり追いかける弾を撃つ。撃ったあと約1秒は撃てない。',
    s: '構え（約0.7秒）の間に飛んできた飛び道具を吸収してダメージを受けない。吸収すると、次に出す攻撃が威力1.6倍・ふっとばし力1.2倍になる（体が水色に光る）。構え中に直接殴られたら、ダメージを受けずに相手をはじき返す（つかみは防げない）。',
    d: 'AIドローンを呼び出す（1機まで、約5秒）。そばを飛びながら、8m以内の相手を自動で撃つ。攻撃を当てると壊れる。ドローンが消えてから約2秒は呼べない。',
    u: 'ワイヤーを伸ばし、届く範囲（6m）の崖をつかんで復帰する。',
  },
  menhera: {
    n: '前に赤い糸を投げる。当たった相手としばらくつながり、相手は3.5mより遠くへ離れられない（自分の%が高いほど短い：0%で約4秒、100%で約2.6秒、最短約1.4秒。自分が場外にいる間は糸がゆるむ）。つながっている間は自分の攻撃力1.2倍。相手が受けたダメージはためておき、糸が切れたときに一気に加わってふっとぶ。強くふっとばすと糸は切れる。使ったあと約2.5秒は使えない。',
    s: 'スマホを投げる。当たった相手の頭の上に「着信中」の印が付き、約2.5秒後に着信音が爆発してダメージとふっとばし（ガードで防げる）。外れたら約2秒、当たったら爆発してから約2秒は使えない。',
    d: 'その場で泣いて、周り（3m以内）に涙を飛ばす。当たった相手は約4秒「気まずい」状態になり、攻撃力が0.8倍に下がる。ガードで防げる。使ったあと約6秒は使えない。',
    u: 'ハートの風船でふわっと上昇する復帰技（真上の相手に当たる）。上昇のあと約1秒はゆっくり落ちる。使ったあとは着地するまで無防備。',
  },
};

/** アピールのセリフ（キャラごとに3つ。SSR衣装のときは ssr のセリフ） */
export const TAUNT_LINES: Record<string, { lines: string[]; ssr: string }> = {
  guard: { lines: ['規約違反です', '巡回中です', '通行証を見せて'], ssr: '黄金の守りに隙はない' },
  hacker: { lines: ['脆弱性みっけ', 'ログは消しといた', 'Enterキー最強'], ssr: 'ゼロデイ、発動' },
  thief: { lines: ['いただきました', 'パスワード丸見え', 'ちょろいね'], ssr: '月が見ていますよ' },
  streamer: { lines: ['バズった！', '高評価よろしく！', 'スパチャありがと〜'], ssr: 'みんな大好き〜！' },
  dopa: { lines: ['飽きた', 'つぎつぎ〜', 'それ前に見た'], ssr: '100万再生いったわ' },
  gacha: { lines: ['あと1回だけ…', '天井まであと少し', '爆死した…'], ssr: '天井は通過点' },
  courier: { lines: ['お届けです！', '置き配しときます', '時間指定ギリ！'], ssr: '光速でお届け！' },
  ai: { lines: ['推論完了', '学習済みです', 'それ、想定内'], ssr: 'シンギュラリティ到達' },
  trainer: { lines: ['あと1回！', '筋肉は裏切らない', 'いい汗かいた！'], ssr: 'これが鋼の肉体だ！' },
  threeb: { lines: ['今日はどんな感じにします？', '次のライブ来てよ', '何かお作りしましょうか'], ssr: 'これがカリスマの実力' },
  menhera: { lines: ['既読つけてよ', 'ずっと一緒だよ？', 'なんで返事くれないの'], ssr: '世界でいちばん愛してる' },
};

/** アイテムの名前（種類の番号順） */
export const ITEM_NAMES = ['おにぎり', 'スニーカー', '砂時計', 'お守り', 'カイロ', '傘', 'メガホン'];
/** アイテムの効果（short = 落ちているアイテムの上に出す短い説明、effect = 拾ったときに大きく出す説明。数値は moves.ts の設定どおり） */
export const ITEM_INFO = [
  { short: '回復', effect: `${ITEMS.heal}%回復！` },
  { short: 'スピードアップ', effect: `${SPEEDUP.duration / 60}秒スピードアップ！` },
  { short: '相手をストップ', effect: `ほかの人が${ITEMS.freeze / 60}秒ストップ！` },
  { short: '無敵', effect: `${ITEMS.invuln / 60}秒無敵！` },
  { short: '攻撃力アップ', effect: `${ITEMS.power / 60}秒攻撃力アップ！` },
  { short: 'ひるまない', effect: `${ITEMS.armor / 60}秒ひるまない！` },
  { short: '衝撃波', effect: 'まわりを吹き飛ばす！' },
];
export const ITEM_COLORS = ['#4fd18b', '#b6ff3a', '#ff5a5a', '#6ab8ff', '#ff8a3a', '#b48cff', '#ffd84a'];

/** CPU の名前に使う短いキャラ名（HUD の名札に収まる長さ） */
const CPU_SHORT: Record<string, string> = {
  guard: '警備員',
  hacker: 'ハッカー',
  thief: '泥棒',
  streamer: '配信者',
  dopa: 'ドパガキ',
  gacha: 'ガチャ廃人',
  courier: '配達員',
  ai: 'AI',
  trainer: 'トレーナー',
  threeb: '3B',
};

/**
 * CPU に「CPU 配信者」のような、キャラで見分けられる名前を付ける（同じキャラが2人以上なら「CPU 配信者2」）。
 * 人の名前はそのまま
 */
export function nameCpus<T extends { name: string; charId: string; cpu: boolean }>(players: T[]): T[] {
  const count = new Map<string, number>();
  for (const p of players) if (p.cpu) count.set(p.charId, (count.get(p.charId) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const p of players) {
    if (!p.cpu) continue;
    const base = `CPU ${CPU_SHORT[p.charId] ?? getCharacter(p.charId).name}`;
    const k = (seen.get(p.charId) ?? 0) + 1;
    seen.set(p.charId, k);
    p.name = (count.get(p.charId) ?? 0) > 1 ? `${base}${k}` : base;
  }
  return players;
}
