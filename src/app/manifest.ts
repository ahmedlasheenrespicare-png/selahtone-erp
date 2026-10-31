import type { MetadataRoute } from "next";

/**
 * يجعل التطبيق قابلًا للتثبيت على الهاتف وسطح المكتب: أيقونة على الشاشة،
 * وفتح في نافذة بلا شريط المتصفح.
 *
 * start_url على "/" لا "/dashboard": فالتطبيق يوجّه كل مستخدم إلى شاشته بنفسه،
 * وفرض صفحة بعينها يجعل من ليس له حق فيها يفتحها ثم يُعاد توجيهه.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "صلة تون للسمعيات",
    short_name: "صلة تون",
    description: "نظام المبيعات والمالية والمخزون لشركة صلة تون للسمعيات.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f4f7fb",
    theme_color: "#0e7c6b",
    lang: "ar",
    dir: "rtl",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
