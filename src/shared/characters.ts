// キャラクター定義（職業がそのままキャラクター）

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

export const CHARACTERS: CharacterDef[] = [
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
    dmgMul: 1.06,
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
    specialNames: { n: 'DDoS', s: '全体メール誤送信', d: 'キャッシュ', u: 'ポップアップ広告' },
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
    trait: { name: '抜き取り', desc: '攻撃を当てると、与えたダメージの1/4だけ自分のダメージ%が回復する。' },
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
    dmgMul: 1.0,
    kbMul: 1.0,
    frameMul: 0.85,
    scale: 0.88,
    specialNames: { n: '倍速再生', s: '無限スクロール', d: '通知爆撃', u: '次の動画へ' },
    trait: { name: '飽き性', desc: '同じ技を続けて出すと、だんだん威力が下がる。' },
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
    dmgMul: 1.16,
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
];

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/** プレイヤー番号ごとの色（頭上の目印・HUDに使う） */
export const SLOT_COLORS = [0xff5a5a, 0x4f9dff, 0xffd23f, 0x4fd18b, 0xc77dff, 0xff9f43];

/** キャラ選択画面で、必殺技を長押ししたときに出す説明（数値は moves.ts・sim.ts の設定どおり） */
export const SPECIAL_DESCS: Record<string, { n: string; s: string; d: string; u: string }> = {
  guard: {
    n: '「利用規約」の看板をゆっくり前へ飛ばす。足は遅いが、当たった相手はふつうの技の約2倍長くひるむ。',
    s: '目の前に燃える壁を出す（約1.3秒）。壁は相手の飛び道具を消し、近づいた相手を押し返す。',
    d: '構え（約0.5秒）の間に攻撃されると、受けたダメージの1.3倍（最低8%）で相手に返す。',
    u: '斜め上へ突進して戻る復帰技。使ったあとは着地するまで無防備。',
  },
  hacker: {
    n: '小さな弾をすばやく3連射する。1発は軽いが、離れた相手を削るのに便利。',
    s: '封筒を上・まっすぐ・下の3方向に同時に飛ばす。',
    d: '足元に罠を置く（1個まで、約10秒）。置いてから0.5秒後から、相手が触れると爆発して上へ飛ばす。',
    u: '足元に広告ウィンドウを出して上昇する。ウィンドウはしばらく残り、上に乗れる。',
  },
  thief: {
    n: 'マルウェアを飛ばす。当たった相手は約3秒間、少しずつダメージを受け続ける。',
    s: 'フラッシュとともに前へ高速で突き抜けて攻撃する。',
    d: 'いちばん近い相手（7m以内）と位置を入れ替える。入れ替えられた相手は一瞬固まる。崖ぎわで使うと相手を場外へ送れる。',
    u: '炎をまとって上昇する復帰技。何度も当たる。使ったあとは着地するまで無防備。',
  },
  streamer: {
    n: 'コインを山なりに投げる。高い所や段差の上の相手に届く。',
    s: '少し前（3m）へ瞬間移動して斬る。間合いを一気に詰められる。',
    d: '周りの地上の相手を眠らせて動けなくする（相手のダメージ%が高いほど長く、最大約2.5秒）。空中の相手には効かず、軽くはじくだけ。',
    u: '上昇しながら、周りにお礼のハートを飛ばす。使ったあとは着地するまで無防備。',
  },
  dopa: {
    n: '約6秒間、動きと攻撃が速くなる。効果が切れてから約7秒は使えない。',
    s: '横へ滑りながら攻撃。Bを押し直すと最大3回まで続けられる。',
    d: '周り（4.5m以内）の相手にダメージを与えて、自分のほうへ引き寄せる。ガード中の相手には効かない。',
    u: '上へ高速で滑り上がる復帰技。途中でもう一度Bを押すと方向転換できる。使ったあとは着地するまで無防備。',
  },
  gacha: {
    n: '毎回ランダム。SSR（8%）：周りを大爆発／SR（14%）：金の弾3発／R（25%）：金の弾1発／N（25%）：石1発／回復（5%）：自分の%が15減る／爆死（23%）：自分が4%受けて少し動けなくなる。',
    s: '前へ殴りかかる。5回に1回ほど大当たりになり、威力2.5倍の超強力な一撃になる。',
    d: '自分のダメージ%が8増える代わりに、約6秒間、攻撃力1.3倍・ふっとばし力1.15倍。効果中は使っても何も起きない。',
    u: '上昇しながら、上から石を降らせる。使ったあとは着地するまで無防備。',
  },
  courier: {
    n: '配達バッグを投げる。しばらく進むと戻ってくるので、行きと帰りの2回当てられる。',
    s: '自転車に乗る（約5秒、地上でのみ）。速く走れて、ぶつかった相手にダメージ。ジャンプで降りる。',
    d: '拾うと12%回復するお弁当を置く（1個まで、約10秒）。相手も拾える。',
    u: '自転車ごと大ジャンプする復帰技。使ったあとは着地するまで無防備。',
  },
  ai: {
    n: 'いちばん近い相手をゆっくり追いかける弾を撃つ。',
    s: '構え（約0.7秒）の間に飛んできた飛び道具を吸収してダメージを受けない。吸収すると、次に出す攻撃が威力1.6倍・ふっとばし力1.2倍になる（体が水色に光る）。直接の攻撃は吸収できない。',
    d: 'AIドローンを呼び出す（1機まで、約5秒）。そばを飛びながら、8m以内の相手を自動で撃つ。攻撃を当てると壊れる。',
    u: 'ワイヤーを伸ばし、届く範囲（6m）の崖をつかんで復帰する。',
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
};

/** アイテムの名前（種類の番号順） */
export const ITEM_NAMES = ['バグ修正パッチ', 'エナドリ', 'サーバーダウン', 'ファイアウォール'];
