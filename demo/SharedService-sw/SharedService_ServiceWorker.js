"use strict";

// Install the service worker as soon as possible.
globalThis.addEventListener('install', (/** @type {ExtendableEvent} */ event) => {
  event.waitUntil(globalThis.skipWaiting());
});
globalThis.addEventListener('activate', (/** @type {ExtendableEvent} */ event) => {
  event.waitUntil(globalThis.clients.claim());
});

// Forward messages (and ports) from client to client.
globalThis.addEventListener('message', async event => {
  if (event.data?.sharedService) {
    const data = event.data;
    const ports = event.ports;
    const client = await globalThis.clients.get(data.clientId);
    client.postMessage(data, ports);
  }
});

// Tell clients their clientId. A service worker isn't actually needed
// for a context to get its clientId, but this also doubles as a way
// to verify that the service worker is active.
globalThis.addEventListener('fetch', async (/** @type {FetchEvent} */ event) => {
  if (event.request.url === globalThis.registration.scope + 'clientId') {
    return event.respondWith(new Response(event.clientId, {
      headers: { "Content-Type": "text/plain" }
    }));
  }
});