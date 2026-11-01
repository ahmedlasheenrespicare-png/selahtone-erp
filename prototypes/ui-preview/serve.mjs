/**
 * خادم المعاينة — خادم ثابت بلا تبعيات.
 *
 * الفرق بينه وبين `python3 -m http.server` أنه يرسل
 * `Cache-Control: no-store`: فالمعاينة تتغيّر كل ساعة، وأي نسخة
 * مخزّنة في المتصفح تجعل المستخدم يحكم على تصميم قديم وهو يظنّه
 * الجديد. المحرّم الوحيد هنا: لا تُقدَّم ملفات خارج مجلد المعاينة.
 *
 * التشغيل: node prototypes/ui-preview/serve.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT ?? 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer(async (request, response) => {
  let path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (path.endsWith("/")) path += "index.html";

  // لا خروج من مجلد المعاينة: يُطبَّع المسار ثم يُتحقَّق من بقائه داخل الجذر.
  const target = join(ROOT, normalize(path));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("403 — خارج مجلد المعاينة");
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": TYPES[extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-store, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("404 — غير موجود");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`معاينة الواجهة على المنفذ ${PORT} — بدون تخزين مؤقت (no-store)`);
});
