/* Wergui SN : garde l'application sur l'appareil pour qu'elle s'ouvre même sans internet.
   Les données (Supabase) ne passent jamais par ce cache. */
const VERSION = "wergui-18";
const CORE = ["./", "./index.html", "./app.css?v=18", "./app.js?v=18", "./config.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(CORE.map(u => c.add(new Request(u, { cache: "reload" }))))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function avecDelai(p, ms) { return new Promise((ok, ko) => { const t = setTimeout(() => ko(new Error("délai")), ms); p.then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); ko(e); }); }); }
async function reseauDabord(req, cle) {
  const c = await caches.open(VERSION);
  try { const r = await avecDelai(fetch(req), 5000); if (r && r.ok) c.put(cle || req, r.clone()); return r; }
  catch (e) { const m = await c.match(cle || req, { ignoreVary: true }); if (m) return m; throw e; }
}
async function cacheDabord(req) {
  const c = await caches.open(VERSION), m = await c.match(req);
  const maj = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone()); return r; }).catch(() => null);
  return m || (await maj) || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (/supabase\.(co|in)$/.test(u.hostname) || u.pathname.includes("/auth/v1/") || u.pathname.includes("/rest/v1/") || u.pathname.startsWith("/sb/")) return; // données : jamais en cache
  if (req.mode === "navigate" && u.origin === location.origin) { e.respondWith(reseauDabord(req, "./index.html").catch(() => caches.match("./"))); return; }
  if (u.origin === location.origin) { e.respondWith(reseauDabord(req)); return; }
  if (u.hostname === "cdn.jsdelivr.net" || u.hostname.endsWith("fonts.googleapis.com") || u.hostname.endsWith("fonts.gstatic.com") || u.pathname.endsWith("/medicaments.json")) { e.respondWith(cacheDabord(req)); }
});
