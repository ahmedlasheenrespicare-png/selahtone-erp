import { requireInventoryEnabled } from "@/lib/inventory-gate";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import "./inventory.css";
import "./inventory-theme.css";

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  await requireInventoryEnabled();
  await requireMenuScopeAccess("/inventory");
  return <div className="inventory-suite">{children}</div>;
}
