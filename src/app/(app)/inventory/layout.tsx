import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import "./inventory.css";

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  await requireMenuScopeAccess("/inventory");
  return children;
}
