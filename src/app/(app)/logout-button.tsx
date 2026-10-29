"use client";

import { AppIcon } from "@/components/app-icon";

export default function LogoutButton() {
  return (
    <form action="/api/logout" method="post">
      <button className="workspace-logout" type="submit">
        <AppIcon name="logout" />
        <span>خروج</span>
      </button>
    </form>
  );
}
