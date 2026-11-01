/**
 * اختيار ورقة الأنماط — للتجربة والمقارنة فقط.
 *
 * العرض: ?css=before يفتح الصفحة بأنماط النسخة السابقة (المؤرشفة في
 * styles-before.css) ليُقارَن التصميمان جنبًا إلى جنب في compare.html.
 * الافتراضي هو الورقة الحالية.
 */
const params = new URLSearchParams(globalThis.location?.search ?? "");
const sheet = params.get("css") === "before" ? "./styles-before.css" : "./styles.css";

const link = document.createElement("link");
link.rel = "stylesheet";
link.href = sheet;
document.head.appendChild(link);

if (sheet.endsWith("before")) document.documentElement.dataset.css = "before";
