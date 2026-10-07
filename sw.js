// Service worker — অফলাইনে আগে দেখা ফলাফল দেখানোর জন্য।
// নীতি: আগে ইন্টারনেট থেকে নতুন ফাইল আনার চেষ্টা (তাই ফলাফল আপডেট করলে সাথে সাথে দেখা যায়),
// ইন্টারনেট না থাকলে সর্বশেষ সেভ করা কপি দেখায়।
const CACHE = "result-portal-v2"; // ফাইল বড় বদলালে সংখ্যা বাড়ান (v3, v4…) — পুরোনো ক্যাশ নিজে মুছে যাবে
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(["./", "index.html", "style.css", "script.js", "exams.json", "logo.png", "manifest.json"]))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Google Fonts: আগে ক্যাশ, পিছনে আপডেট
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          const net = fetch(req).then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; }).catch(() => hit);
          return hit || net;
        })
      )
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // নিজের সাইটের ফাইল: network-first, ফেল করলে ক্যাশ
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((hit) => hit || caches.match("index.html"))
      )
  );
});
