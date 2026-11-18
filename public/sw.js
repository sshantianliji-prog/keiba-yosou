// 通知を受け取って表示する
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let n = { title: '予想完了', body: '', url: '/' };
    try {
      const r = await fetch('/api/push/latest', { credentials: 'include', cache: 'no-store' });
      if (r.ok) n = await r.json();
    } catch {}
    await self.registration.showNotification(n.title || '予想完了', {
      body: n.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: n.tag, data: { url: n.url || '/' },
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) {
      if ('focus' in c) { await c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
