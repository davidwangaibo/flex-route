const CHUNK = 1024 * 1024, TIMEOUT = 2e4;
const pending = /* @__PURE__ */ new Map();
let nextId = 1;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => {
  const m = e.data;
  if (m && m.t === "range-res" && pending.has(m.rid)) {
    pending.get(m.rid)(m);
    pending.delete(m.rid);
  }
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  const i = u.pathname.indexOf("/__stream/");
  if (i >= 0) e.respondWith(serve(e, u.pathname.slice(i + 10)));
});
async function serve(e, id) {
  const client = await self.clients.get(e.clientId) || (await self.clients.matchAll({ type: "window" }))[0];
  if (!client) return new Response("", { status: 504 });
  const m = /bytes=(\d+)-(\d*)/.exec(e.request.headers.get("range") || "");
  const start = m ? +m[1] : 0;
  const end = m && m[2] ? Math.min(+m[2], start + CHUNK - 1) : start + CHUNK - 1;
  const rid = nextId++;
  const res = await new Promise((done) => {
    pending.set(rid, done);
    setTimeout(() => {
      if (pending.delete(rid)) done({ error: true });
    }, TIMEOUT);
    client.postMessage({ t: "range-req", rid, id, start, end });
  });
  if (res.error) return new Response("", { status: 504 });
  return new Response(res.buf, { status: 206, headers: {
    "Content-Type": res.mime || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Content-Length": String(res.buf.byteLength),
    "Content-Range": "bytes ".concat(start, "-").concat(start + res.buf.byteLength - 1, "/").concat(res.total)
  } });
}
