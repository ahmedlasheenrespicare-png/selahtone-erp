import type { SVGProps } from "react";

export type AppIconName =
  | "dashboard"
  | "inventory"
  | "settings"
  | "expenses"
  | "cash"
  | "reports"
  | "sales"
  | "receipt"
  | "branch"
  | "warehouse"
  | "products"
  | "stockValue"
  | "calendar"
  | "arrow"
  | "logout"
  | "lock"
  | "menu"
  | "close"
  | "check";

type AppIconProps = SVGProps<SVGSVGElement> & { name: AppIconName };

/** Small, consistently styled icons used by the internal workspace. */
export function AppIcon({ name, ...props }: AppIconProps) {
  let content;

  switch (name) {
    case "dashboard":
      content = <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>;
      break;
    case "inventory":
      content = <><path d="m3 7 9-4 9 4-9 4-9-4Z" /><path d="M3 7v10l9 4 9-4V7M12 11v10" /><path d="m7.5 5 9 4" /></>;
      break;
    case "settings":
      content = <><path d="M12 3 4.5 6v5.5c0 4.4 3 7.7 7.5 9.5 4.5-1.8 7.5-5.1 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></>;
      break;
    case "expenses":
      content = <><path d="M5 3.5h14v17l-3-1.8-4 1.8-4-1.8-3 1.8v-17Z" /><path d="M8 8h8M8 12h8M8 16h4" /></>;
      break;
    case "cash":
      content = <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M16 10h5v5h-5a2.5 2.5 0 0 1 0-5ZM16.5 12.5h.01" /></>;
      break;
    case "reports":
      content = <><path d="M4 20h16M6 16v-5M12 16V5M18 16V8" /><circle cx="6" cy="9" r="1" /><circle cx="12" cy="3" r="1" /><circle cx="18" cy="6" r="1" /></>;
      break;
    case "sales":
      content = <><path d="M3 9h18l-1-5H4L3 9ZM4 9v10h16V9M9 19v-6h6v6" /><path d="M3 9a3 3 0 0 0 4.5 2A3 3 0 0 0 12 11a3 3 0 0 0 4.5 0A3 3 0 0 0 21 9" /></>;
      break;
    case "receipt":
      content = <><path d="M6 3h12v18l-3-1.7-3 1.7-3-1.7L6 21V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>;
      break;
    case "branch":
      content = <><path d="M4 21h16M6 21V7l6-4 6 4v14M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 21v-4h4v4" /></>;
      break;
    case "warehouse":
      content = <><path d="M3 10 12 4l9 6v10H3V10Z" /><path d="M7 20v-7h10v7M7 16.5h10" /></>;
      break;
    case "products":
      content = <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 9h16M9 9v11" /><path d="M7 6.5h.01" /></>;
      break;
    case "stockValue":
      content = <><path d="M4 18.5h16M6 16V9l6-4 6 4v7M9 16v-4h6v4" /><path d="M10 8h4" /></>;
      break;
    case "calendar":
      content = <><rect x="4" y="6" width="16" height="14" rx="2" /><path d="M8 3.5v5M16 3.5v5M4 10h16M8 14h.01M12 14h.01M16 14h.01" /></>;
      break;
    case "arrow":
      content = <><path d="M19 12H5M10 7l-5 5 5 5" /></>;
      break;
    case "logout":
      content = <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l4 4-4 4M8 12h10" /></>;
      break;
    case "lock":
      content = <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>;
      break;
    case "menu":
      content = <><path d="M4 7h16M4 12h16M4 17h16" /></>;
      break;
    case "close":
      content = <><path d="m6 6 12 12M18 6 6 18" /></>;
      break;
    case "check":
      content = <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>;
      break;
  }

  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{content}</svg>;
}
