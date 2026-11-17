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
    id: '2026-11-17-3',
    date: '2026/11/17',
    title: 'キャラ調整',
    items: [
      { kind: 'buff', text: '配信者：強制アップデート（下B）の範囲を少し広く' },
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
