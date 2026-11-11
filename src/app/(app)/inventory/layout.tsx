import { requireInventoryEnabled } from "@/lib/inventory-gate";

import "./inventory.css";
import "./inventory-theme.css";

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  await requireInventoryEnabled();
  return <div className="inventory-suite">{children}</div>;
}
