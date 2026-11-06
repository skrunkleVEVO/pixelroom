// A template: the plugin in vite.config.ts fills in the cache version and file list at
// build time. Precaching everything means the installed app works with no connection.
const CACHE = 'pixelroom-__VERSION__';
const SHARE_CACHE = 'pixelroom-shared';
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('pixelroom-') && k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
});

// Photos shared from another app (manifest share_target): park them, then open the app.
async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open(SHARE_CACHE);
  for (const key of await cache.keys()) await cache.delete(key);
  let i = 0;
  for (const file of form.getAll('photos')) {
    if (!(file instanceof File)) continue;
    await cache.put(
      `./shared/${Date.now()}-${i++}`,
      new Response(file, {
        headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
      }),
    );
  }
  return Response.redirect('./?shared', 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;

  // Pages try the network first so a deploy shows up; everything else has a hashed name.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html', { cacheName: CACHE })));
    return;
  }
  event.respondWith(caches.match(request, { cacheName: CACHE }).then((hit) => hit ?? fetch(request)));
});
