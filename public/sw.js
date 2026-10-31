/*
 * خدمة عميل متحفّظة: تُسرّع التحميل وتسمح بالتثبيت، ولا تحفظ مالًا قط.
 *
 * القاعدة الحاكمة: **لا يُخزَّن إلا ما لا يتغيّر**. فأصول الواجهة
 * (‎/_next/static‎) مسمّاة بما يعادل محتواها، فهي آمنة للتخزين. أما صفحات
 * الحسابات والأرصدة فليست كذلك، فتُطلب من الشبكة أولًا ولا يُرجَع إلى المخزون
 * إلا عند انقطاعها — وذاك أفضل من شاشة بيضاء، وإن كان قديمًا.
 *
 * وكل ما يحمل مالًا لا يُخزَّن أصلًا: الطلبات غير GET — ومنها Server Actions
 * التي تُنفذ البيع والتسوية — تمرّ إلى الشبكة بلا تخزين، فلا تُعاد كتابةٌ مرتين
 * ولا يُحفظ رصيد.
 */

const VERSION = "selahtone-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

// قائمة التثبيت تُترك فارغة قصدًا: فتخزين صفحة كاملة عند التثبيت يعني أن كل
// تحديث للتطبيق يحتاج تغيير نسخة القائمة يدويًا، وتركها فارغة أقل أخطاءً.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("selahtone-") && !key.startsWith(VERSION)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/") || pathname.startsWith("/fonts/");
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    // التحويلات لا تُخزَّن: فقد تكون إعادة توجيه إلى تسجيل الدخول، وتخزينها
    // يحبس المستخدم في صفحة لا يملك حقها.
    if (response.ok && response.type === "basic") cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // نقطة الفحص تقرأ قاعدة البيانات، فتخزينها يُظهر «سليم» وهي ليست كذلك.
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request).catch(async () => {
        const cache = await caches.open(PAGE_CACHE);
        return (await cache.match(request)) ?? (await cache.match("/")) ?? Response.error();
      }),
    );
  }
});
