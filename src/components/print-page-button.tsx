"use client";

import { AppIcon } from "@/components/app-icon";

type PrintPageButtonProps = {
  label?: string;
  mode?: "a4" | "thermal";
  className?: string;
  title?: string;
};

export default function PrintPageButton({
  label = "طباعة",
  mode = "a4",
  className = "dashboard-quick-btn",
  title,
}: PrintPageButtonProps) {
  function handlePrint(): void {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    root.dataset.printMode = mode;
    const cleanup = () => {
      delete root.dataset.printMode;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  return (
    <button
      type="button"
      className={`${className} no-print`}
      title={title ?? label}
      onClick={handlePrint}
    >
      <AppIcon name="printer" />
      <span>{label}</span>
    </button>
  );
}
