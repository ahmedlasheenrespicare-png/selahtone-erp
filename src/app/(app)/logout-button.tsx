"use client";

export default function LogoutButton() {
  return (
    <form action="/api/logout" method="post">
      <button className="btn secondary" type="submit" style={{ padding: "7px 14px", fontSize: 12.5 }}>
        خروج
      </button>
    </form>
  );
}
