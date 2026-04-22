import { API_BASE } from './api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Registers the SW, requests notification permission, subscribes the browser
// to the server's VAPID key, and persists the resulting endpoint on the user.
// Caller supplies the JWT (AuthContext stores token in a ref, not localStorage).
export async function enablePushNotifications(token) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push not supported by this browser');
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permission denied');

  const keyRes = await fetch(`${API_BASE}/api/push/public-key`).then((r) => r.json());
  if (!keyRes?.publicKey) throw new Error('Server has no VAPID key');

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey),
  });

  const res = await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
    body: JSON.stringify(sub.toJSON()),
  });
  const j = await res.json();
  if (!j.success) throw new Error(j.message || 'subscribe failed');
  return true;
}

export async function disablePushNotifications(token) {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await sub.unsubscribe();
  await fetch(`${API_BASE}/api/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
}
