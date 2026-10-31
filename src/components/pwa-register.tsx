"use client";

import { useEffect } from "react";

/**
 * تسجيل خدمة العميل. لا يعمل في التطوير: فملف الخدمة يبقى في الذاكرة هناك،
 * فيعرض صفحات قديمة ويجعل تتبّع الأخطاء أصعب من أن يستحق.
 *
 * والتسجيل متأخّر عن تحميل الصفحة (load) لا مقترنًا به: فالتخزين لا ينبغي أن
 * ينافس تحميل البيانات التي يحتاجها المستخدم أولًا.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        // فشل التسجيل لا يكسر التطبيق: يظلّ موقعًا عاديًا. فلا يُعرض خطأ للمستخدم.
        console.warn("pwa: service worker registration failed", error);
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
