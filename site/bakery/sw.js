// Minimal service worker so Android Chrome offers "Install app" (full screen, no browser bars).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});   // network as normal
