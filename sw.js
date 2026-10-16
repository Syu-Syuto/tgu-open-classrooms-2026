"use strict";
const CACHE = "tgu-open-classrooms-pwa-20261017-1";
const ROOT = new URL("./", self.location.href);
const TAG = "tgu-open-classrooms-next-class";
const FILES = ["./", "index.html", "styles.css", "app.js", "timetable.js", "notification-model.js", "pwa.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "data/room-schedule-2026.json", "data/rooms-2026.json"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(file => new Request(new URL(file, ROOT), {cache:"reload"})))));
});
async function closeNotifications() {
  const notifications = await self.registration.getNotifications({tag:TAG});
  notifications.forEach(notification => notification.close());
}
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("tgu-open-classrooms-pwa-") && key !== CACHE) await caches.delete(key);
    await closeNotifications(); await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const relative = url.pathname.slice(ROOT.pathname.length);
  if (!FILES.includes(relative || "./")) return;
  const key = new Request(new URL(relative || "./", ROOT));
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) { await cache.put(key, response.clone()); return response; }
      return (await cache.match(key)) || response;
    } catch {
      return (await cache.match(key)) || Response.error();
    }
  })());
});
let notificationQueue = Promise.resolve();
self.addEventListener("message", event => {
  if (!event.source?.url || !event.source.url.startsWith(ROOT.href)) return;
  if (event.data?.type === "SKIP_WAITING") { self.skipWaiting(); return; }
  if (event.data?.type !== "CLASS_NOTIFICATION") return;
  notificationQueue = notificationQueue.catch(() => {}).then(async () => {
    const payload = event.data.payload, now = Date.now();
    const clients = await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const visible = clients.some(client => client.url.startsWith(ROOT.href) && client.visibilityState === "visible");
    if (!payload || !visible || !Number.isFinite(payload.startAt) || payload.startAt <= now
      || !Number.isFinite(payload.updatedAt) || Math.abs(now-payload.updatedAt)>65000) { await closeNotifications(); return; }
    const formatter = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",hourCycle:"h23"});
    const parts = date => Object.fromEntries(formatter.formatToParts(date).map(p=>[p.type,p.value]));
    const current = parts(now), start = parts(payload.startAt);
    if (["Sat","Sun"].includes(current.weekday) || Number(current.hour)<5
      || ["year","month","day"].some(key=>current[key]!==start[key])) { await closeNotifications(); return; }
    await self.registration.showNotification(String(payload.title), {
      body: String(payload.body), tag:TAG, renotify:false, silent:true,
      icon:new URL("icons/icon-192.png",ROOT).href,
      timestamp:payload.updatedAt, data:{url:ROOT.href,startAt:payload.startAt},
    });
  });
  event.waitUntil(notificationQueue.then(() => event.ports[0]?.postMessage({ok:true}), () => event.ports[0]?.postMessage({ok:false})));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const client = clients.find(item => item.url.startsWith(ROOT.href));
    if (client) return client.focus();
    return self.clients.openWindow(ROOT.href);
  })());
});
