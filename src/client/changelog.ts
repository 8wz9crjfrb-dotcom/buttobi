// アップデートのお知らせ（新しいものを先頭に書き足す）。id は日付＋番号で、新しいほど大きくなるようにする

export type NewsKind = 'new' | 'buff' | 'nerf' | 'fix';

export interface NewsEntry {
  id: string;
  date: string;
  title: string;
  items: { kind: NewsKind; text: string }[];
}

export const NEWS_LABEL: Record<NewsKind, string> = { new: '新機能', buff: '強化', nerf: '弱体化', fix: '修正' };

export const NEWS: NewsEntry[] = [
  {
    id: '2026-11-17-4',
    date: '2026/11/17',
    title: 'アップデートのお知らせ機能',
    items: [
      { kind: 'new', text: 'アップデート内容をお知らせで見られるように（右上のベルのボタン）' },
      { kind: 'new', text: '新しいバージョンが出たら、画面の上に「更新する」ボタンが出るように' },
    ],
  },
  {
    id: '2026-11-17-3',
    date: '2026/11/17',
    title: 'キャラ調整と玉入れのチーム',
    items: [
      { kind: 'buff', text: '配信者：強制アップデート（下B）の範囲を少し広く' },
      { kind: 'buff', text: 'ドパガキ：倍速再生の待ち時間を約5.5秒に。飽き性の最大倍率を1.3倍に' },
      { kind: 'buff', text: 'ガチャ廃人：単発ガチャの爆死を18%に。横Bの威力を少しアップ' },
      { kind: 'new', text: '玉入れのチーム（赤・青）を自由に選べるように' },
    ],
  },
  {
    id: '2026-11-17-2',
    date: '2026/11/17',
    title: 'ステージルーレットとキャラ調整',
    items: [
      { kind: 'new', text: 'ステージ「おまかせ」はルーレットで決まるように' },
      { kind: 'new', text: 'ハッカーの横Bが「Ctrl+Z」に（約2秒前の場所に戻り、その間のダメージを半分消す）' },
      { kind: 'nerf', text: 'ハッカー：DDoSの待ち時間1.5秒、キャッシュのダメージ10' },
      { kind: 'new', text: '配達員：自転車に乗ったままジャンプできるように' },
      { kind: 'nerf', text: '配達員：置き配の回復6%、自転車の待ち時間2秒、ダメージ合計10%で降りる' },
      { kind: 'nerf', text: '配信者：投げ銭に約1秒の待ち時間、コインが少しゆっくりに' },
      { kind: 'nerf', text: '飛び道具が当たったときのひるみ時間を半分に' },
      { kind: 'nerf', text: 'ガチャのSSRの排出率を7%に' },
      { kind: 'fix', text: '回線が切れたあと試合に戻れないことがあるのを修正' },
      { kind: 'fix', text: '攻撃ボタンが反応しない・ガードが勝手に出ることがあるのを修正' },
    ],
  },
  {
    id: '2026-11-17-1',
    date: '2026/11/17',
    title: 'サドンデスなど',
    items: [
      { kind: 'new', text: '1位が同点ならサドンデス（延長戦）で決着' },
      { kind: 'new', text: '残り10秒でタイマーが赤くなり、音が鳴るように' },
      { kind: 'new', text: 'アイテムの出る頻度と種類をルールで選べるように' },
      { kind: 'new', text: 'アイテムにカイロ（攻撃力アップ）・傘（ひるまない）・メガホン（衝撃波）を追加' },
      { kind: 'new', text: 'プロフィールの成績を見やすく。トーナメント優勝回数・予想の的中率も表示' },
      { kind: 'new', text: 'スタンプを4つ追加' },
    ],
  },
  {
    id: '2026-11-16-1',
    date: '2026/11/16',
    title: 'トーナメントと勝敗予想',
    items: [
      { kind: 'new', text: 'トーナメント（1対1の勝ち抜き戦）。3位決定戦もルールで選べる' },
      { kind: 'new', text: '試合に出ていない人は勝敗予想ができる（オッズに応じてコイン）' },
      { kind: 'new', text: '乱入アイテム：試合に出ていない人がアイテムを落とせる' },
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
