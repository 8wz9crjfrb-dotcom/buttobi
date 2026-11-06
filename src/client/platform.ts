// 端末ごとの違い（iOS / Android）と PWA まわりの処理

export const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isAndroid = /Android/i.test(navigator.userAgent);

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

let installEvent: BeforeInstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  // Android の Chrome：ゲーム内のボタンからインストールできるようにする
  e.preventDefault();
  installEvent = e as BeforeInstallPromptEvent;
  document.dispatchEvent(new CustomEvent('installable'));
});

export function canInstall(): boolean {
  return installEvent !== null;
}

export async function promptInstall(): Promise<void> {
  if (!installEvent) return;
  await installEvent.prompt();
  installEvent = null;
}

/** Android などで全画面＋横向き固定を試す（iOS では使えないので何もしない） */
export async function enterFullscreenLandscape(): Promise<void> {
  if (isIOS) return;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch {
    /* 拒否されても続ける */
  }
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch {
    /* 対応していない端末では何もしない */
  }
}

let wakeLock: { release(): Promise<void> } | null = null;

/** 対戦中は画面が暗くならないようにする（対応端末のみ） */
export async function keepAwake(on: boolean): Promise<void> {
  try {
    const nav = navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } };
    if (on && !wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
    if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

/** 振動（Android の Chrome のみ。iOS は未対応） */
export function vibrate(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 無視 */
  }
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 登録できなくても遊べる */
    });
  });
}

/**
 * ダブルタップでの拡大・ピンチでの拡大を防ぐ（iOS Safari 対策）。
 * CSS の touch-action だけでは連打したときに拡大されることがあるため、タッチの既定動作を止める。
 * - 対戦画面（スティック・ボタン・ゲーム画面）：タッチ開始の既定動作を止める
 * - それ以外（メニューなど）：350ms 以内に「ほぼ同じ場所」を2回叩いたときだけ既定動作を止める
 *   （違うボタンを素早く続けて押すのは通常どおり効く）
 */
export function preventZoomGestures(): void {
  const gameArea = '#touch, #game-canvas, #hud';
  document.addEventListener(
    'touchstart',
    (e) => {
      const t = e.target as Element | null;
      if (t?.closest?.(gameArea)) e.preventDefault();
      if (e.touches.length > 1 && !t?.closest?.('input, textarea')) e.preventDefault();
    },
    { passive: false },
  );
  let lastEnd = 0;
  let lastX = -999;
  let lastY = -999;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = performance.now();
      const t = e.target as Element | null;
      const p = e.changedTouches[0];
      const x = p?.clientX ?? -999;
      const y = p?.clientY ?? -999;
      const near = Math.hypot(x - lastX, y - lastY) < 40;
      if (now - lastEnd < 350 && near && !t?.closest?.('input, textarea')) e.preventDefault();
      lastEnd = now;
      lastX = x;
      lastY = y;
    },
    { passive: false },
  );
  for (const type of ['gesturestart', 'gesturechange', 'dblclick']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
}
