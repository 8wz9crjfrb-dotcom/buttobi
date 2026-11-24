// テスト版（/buttobi/test/ に置く版）のときだけ動く準備。
// テスト版は本番と同じアドレス（github.io）なので、端末の保存データ（localStorage）を共有してしまう。
// 本番のコイン・衣装・設定を書き換えないよう、テスト版では保存する名前の前に「test:」を付けて分ける。
// ほかのファイルより先に読み込むこと（main.ts の最初の import）

export const IS_TEST = import.meta.env.VITE_TEST === '1';

if (IS_TEST) {
  const P = 'test:';
  const proto = Storage.prototype;
  const get = proto.getItem;
  const set = proto.setItem;
  const remove = proto.removeItem;
  proto.getItem = function (key: string) {
    return get.call(this, P + key);
  };
  proto.setItem = function (key: string, value: string) {
    set.call(this, P + key, value);
  };
  proto.removeItem = function (key: string) {
    remove.call(this, P + key);
  };
  // 画面の右下に「テスト版」の印
  const mark = () => {
    const el = document.createElement('div');
    el.id = 'test-mark';
    el.textContent = 'テスト版';
    el.style.cssText =
      'position:fixed;right:6px;bottom:calc(4px + env(safe-area-inset-bottom));z-index:9999;padding:2px 8px;border-radius:8px;background:#ff3b6c;color:#fff;font:900 11px sans-serif;pointer-events:none;opacity:.85';
    document.body.appendChild(el);
  };
  if (document.body) mark();
  else window.addEventListener('DOMContentLoaded', mark);
}
