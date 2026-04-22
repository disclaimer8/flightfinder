// himaxym service worker — push notifications for My Trips alerts.

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'himaxym';
  const options = {
    body:  data.body || '',
    icon:  '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    data:  { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
