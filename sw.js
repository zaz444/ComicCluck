// sw.js — retiring the service worker
// This intentionally replaces the old caching service worker. Anyone who
// already installed the previous version will fetch this file on their
// next update check, install it, and it will immediately unregister itself
// and clear every cache this app ever created — handing control back to
// normal browser HTTP caching, no service worker at all from then on.
//
// Leave this file in place (don't just delete it from the repo) until
// you're confident every returning visitor has picked it up. A 404 works
// eventually too, but this is faster and more consistent across browsers.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // wipe every cache this app (any version) ever created
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));

      // unregister so future loads skip the service worker entirely
      await self.registration.unregister();

      // reload any open tabs so they drop the SW immediately instead of
      // waiting for their next navigation
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.navigate(client.url));
    })()
  );
});
