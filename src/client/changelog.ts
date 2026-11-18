// アップデートのお知らせ（新しいものを先頭に書き足す）。id は日付＋番号で、新しいほど大きくなるようにする

export type NewsKind = 'new' | 'buff' | 'nerf' | 'fix';

export interface NewsEntry {
  id: string;
  date: string;
  title: string;
  items: { kind: NewsKind; text: string }[];
}

export const NEWS_LABEL: Record<NewsKind, string> = { new: '新機能', buff: '強化', nerf: '弱体化', fix: '修正' };

// お知らせは、ふだんの修正（サイレント修正）では書き足さない。お知らせするよう頼まれたときだけ書き足す。
// 数値を変えたときは「何から何に変わったか」（例：12% → 7%）を書く
export const NEWS: NewsEntry[] = [
  {
    id: '2026-11-18-4',
    date: '2026/11/18',
    title: 'ハッカーとAIエンジニアの調整',
    items: [
      { kind: 'new', text: 'ハッカー：横Bを「全体メール誤送信」から新しい技「Ctrl+Z」に変更（約2秒前にいた場所へ戻り、その間に受けたダメージの半分を消す。空中でも使える。使ったあと約6秒は使えない）' },
      { kind: 'nerf', text: 'ハッカー：DDoS（B）の待ち時間 約1秒 → 約1.5秒' },
      { kind: 'nerf', text: 'ハッカー：キャッシュ（下B）の罠のダメージ 12% → 10%' },
      { kind: 'nerf', text: 'AIエンジニア：推論（B）の待ち時間 約0.5秒 → 約1秒' },
    ],
  },
  {
    // 内容を変えたので番号を上げ、すでに読んだ人にももう一度出す
    id: '2026-11-18-3',
    date: '2026/11/18',
    title: '新モード2つと配達員の調整',
    items: [
      { kind: 'new', text: '新モード「王冠うばい」：最初に相手を倒した人が王冠を手に入れ、持っている間だけ時間がたまる。持っている人に攻撃を当てるか倒すと奪える。持っている人が自分で落ちたら、中央に王冠が出てくる。チーム戦でも王冠は1つなので、仲間で守ろう' },
      { kind: 'new', text: '新モード「金庫まもり」：赤・青のチームで自分の金庫を守り、相手の金庫を壊す。先に壊すか、時間切れで多く壊していたチームの勝ち（小数第1位まで比べる）' },
      { kind: 'buff', text: '配達員：自転車に乗ったままジャンプできるように（これまではジャンプすると降りていた。攻撃・必殺技・ガードで降りる）' },
      { kind: 'nerf', text: '配達員：置き配の回復 12% → 7%' },
      { kind: 'nerf', text: '配達員：自転車の待ち時間（降りてから乗れるまで）約1秒 → 約2秒' },
      { kind: 'nerf', text: '配達員：自転車の耐久 13% → 10%（受けたダメージの合計がこれをこえるか、強い攻撃を受けると降りる）' },
    ],
  },
  {
    // 内容を変えたので番号を上げ、すでに読んだ人にももう一度出す
    id: '2026-11-18-2',
    date: '2026/11/17',
    title: 'キャラ調整',
    items: [
      { kind: 'buff', text: '配信者：強制アップデート（下B）の範囲（半径）1.6 → 1.8' },
      { kind: 'nerf', text: '配信者：投げ銭（B）の待ち時間 なし → 約1秒' },
      { kind: 'buff', text: 'ドパガキ：倍速再生の待ち時間 約7秒 → 約5.5秒' },
      { kind: 'buff', text: 'ドパガキ：飽き性の最大倍率 1.24倍 → 1.3倍' },
      { kind: 'buff', text: 'ガチャ廃人：単発ガチャの爆死の確率 21% → 18%' },
      { kind: 'buff', text: 'ガチャ廃人：横Bの威力 6% → 7%（ふっとばしも少しアップ）' },
    ],
  },
];

const KEY = 'buttobi-news-seen-v1';

/** 最後に読んだお知らせの id（なければ空） */
export function newsSeen(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function markNewsSeen(): void {
  try {
    localStorage.setItem(KEY, NEWS[0]?.id ?? '');
  } catch {
    /* 保存できなくても続ける */
  }
}

/** まだ読んでいないお知らせ（新しい順） */
export function unreadNews(): NewsEntry[] {
  const seen = newsSeen();
  return NEWS.filter((n) => n.id > seen);
}
