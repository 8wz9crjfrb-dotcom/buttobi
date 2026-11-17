// アップデートのお知らせ（新しいものを先頭に書き足す）。id は日付＋番号で、新しいほど大きくなるようにする

export type NewsKind = 'new' | 'buff' | 'nerf' | 'fix';

export interface NewsEntry {
  id: string;
  date: string;
  title: string;
  items: { kind: NewsKind; text: string }[];
}

export const NEWS_LABEL: Record<NewsKind, string> = { new: '新機能', buff: '強化', nerf: '弱体化', fix: '修正' };

// お知らせは、ふだんの修正（サイレント修正）では書き足さない。お知らせするよう頼まれたときだけ書き足す
export const NEWS: NewsEntry[] = [
  {
    id: '2026-11-17-6',
    date: '2026/11/17',
    title: '新モード2つと配達員の調整',
    items: [
      { kind: 'new', text: '新モード「王冠うばい」：王冠を持っている間だけ時間がたまる。持っている人に攻撃を当てると奪える。何人でも遊べる' },
      { kind: 'new', text: '新モード「金庫まもり」：赤・青のチームで自分の金庫を守り、相手の金庫を壊す。先に壊すか、時間切れで多く壊していたチームの勝ち' },
      { kind: 'new', text: '配達員：自転車に乗ったままジャンプできるように（攻撃・必殺技・ガードで降りる）' },
      { kind: 'nerf', text: '配達員：置き配の回復を6%に' },
      { kind: 'nerf', text: '配達員：自転車を降りてから約2秒は乗れないように。受けたダメージの合計が10%をこえるか、強い攻撃を受けると降りる' },
    ],
  },
  {
    // 内容を足したので番号を上げ、すでに読んだ人にももう一度出す
    id: '2026-11-17-5',
    date: '2026/11/17',
    title: 'キャラ調整',
    items: [
      { kind: 'buff', text: '配信者：強制アップデート（下B）の範囲を少し広く' },
      { kind: 'nerf', text: '配信者：投げ銭（B）を投げたあと、約1秒は投げられないように' },
      { kind: 'buff', text: 'ドパガキ：倍速再生の待ち時間を約5.5秒に。飽き性の最大倍率を1.3倍に' },
      { kind: 'buff', text: 'ガチャ廃人：単発ガチャの爆死を18%に。横Bの威力を少しアップ' },
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
