import type { createBrowserRouter } from 'react-router-dom';
import { devicePrefs } from './device-prefs';

export async function enterFullscreen(element: HTMLElement) {
  if (!document.fullscreenElement) await element.requestFullscreen({ navigationUI: 'hide' });
  if (document.fullscreenElement) {
    await (screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> }).lock?.('landscape').catch(() => {});
  }
}

/** Request during the navigation click, before asynchronous media loading loses user activation. */
export function installPlaybackFullscreen(router: ReturnType<typeof createBrowserRouter>) {
  const isPlayback = (path: string) => /^\/(watch|play)\/[^/]+/.test(path);
  let wasPlayback = isPlayback(router.state.location.pathname);
  let owned = false;
  const exit = () => {
    if (owned && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {});
    owned = false;
  };
  const unsubscribe = router.subscribe(state => {
    const playback = isPlayback(state.location.pathname);
    if (playback && !wasPlayback && devicePrefs().fullscreenOnPlay && navigator.userActivation?.isActive && typeof document.documentElement.requestFullscreen === 'function' && !document.fullscreenElement) {
      owned = true;
      void enterFullscreen(document.documentElement).then(() => {
        owned = document.fullscreenElement === document.documentElement;
        if (!isPlayback(router.state.location.pathname)) exit();
      }).catch(() => { owned = false; });
    } else if (!playback) exit();
    wasPlayback = playback;
  });
  return () => { unsubscribe(); exit(); };
}
