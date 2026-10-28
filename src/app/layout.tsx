import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "صلة تون — نظام الإيرادات والمصروفات",
  description: "نظام إدارة مالي لشركة صلة تون للسمعيات: فروع، مخزون، مصروفات، وقيود.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
