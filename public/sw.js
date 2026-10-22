// 두두인연 휴대폰 알림 (서비스 워커)
// - 서버가 보낸 알림을 화면에 띄운다
// - 알림을 누르면 앱을 열고 그 알림의 화면으로 이동한다
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || '두두인연', {
      body: d.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: d.tag,
      lang: 'ko',
      data: { url: d.url || '/home' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/home', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((c) => c.url.startsWith(self.location.origin));
      if (win) {
        // 열려 있는 앱이 있으면 새로 고치지 않고 그 화면으로 이동시킨다
        // 앞으로 가져오기에 실패해도(브라우저 제한) 화면 이동은 한다
        await win.focus().catch(() => {});
        win.postMessage({ type: 'open', url });
        return;
      }
      await self.clients.openWindow(url);
    })()
  );
});
