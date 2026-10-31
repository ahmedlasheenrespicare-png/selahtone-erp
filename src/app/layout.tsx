import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa-register";
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/latin-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "@fontsource/ibm-plex-sans-arabic/latin-600.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-700.css";
import "@fontsource/ibm-plex-sans-arabic/latin-700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "صلة تون — نظام الإيرادات والمصروفات",
  description: "نظام إدارة مالي لشركة صلة تون للسمعيات: فروع، مخزون، مصروفات، وقيود.",
  applicationName: "صلة تون",
  appleWebApp: { capable: true, title: "صلة تون", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};

/** لون الشريط على الهاتف، وعدم التصغير: فالنظام يُستعمل على شاشات صغيرة. */
export const viewport: Viewport = {
  themeColor: "#0e7c6b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
