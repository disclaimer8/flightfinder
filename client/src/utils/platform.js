// Capacitor detection: distinguishes native iOS/Android WebView from the
// regular web build. Used to hide subscription checkout inside the native
// app (Apple 3.1.1: must use IAP if we sell digital goods in-app) — users
// upgrade on himaxym.com instead.
export function isNativeApp() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function') return false;
  return cap.isNativePlatform();
}

export async function openExternal(url) {
  if (isNativeApp() && window.Capacitor?.Plugins?.Browser?.open) {
    await window.Capacitor.Plugins.Browser.open({ url });
    return;
  }
  window.location.href = url;
}
