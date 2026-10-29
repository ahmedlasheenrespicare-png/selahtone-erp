import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";

const base = process.env.AUTH_TEST_BASE_URL ?? "http://localhost:3000";

async function request(path: string, headers: Record<string, string> = {}) {
  const url = new URL(path, base);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = transport.get(url, { headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on("error", reject);
  });
}

test("protected paths redirect unauthenticated users and keep the requested query", async () => {
  const result = await request("/inventory?filter=test");
  assert.equal(result.status, 307);
  assert.match(result.headers["cache-control"] ?? "", /no-store/);
  const location = new URL(result.headers.location!, base);
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("next"), "/inventory?filter=test");
});

test("middleware redirects to the public forwarded host, not the internal server", async () => {
  const result = await request("/inventory", {
    host: "preview.example.test",
    "x-forwarded-host": "preview.example.test",
    "x-forwarded-proto": "https",
  });
  assert.equal(result.status, 307);
  const location = new URL(result.headers.location!, base);
  assert.equal(location.origin, "https://preview.example.test");
  assert.equal(location.pathname, "/login");
});

test("a spoofed forwarded host cannot turn the redirect into an external redirect", async () => {
  const result = await request("/inventory", {
    host: "site.example.test",
    "x-forwarded-host": "evil.example.test",
    "x-forwarded-proto": "https",
  });
  assert.equal(result.status, 307);
  assert.equal(new URL(result.headers.location!, base).origin, "https://site.example.test");
});

test("invalid session cookies are removed", async () => {
  const result = await request("/inventory", { cookie: "selahtone_session=not-a-jwt" });
  assert.equal(result.status, 307);
  assert.match(result.headers["set-cookie"]?.join(" ") ?? "", /selahtone_session=;.*Max-Age=0/i);
});

test("login and icons load without exposing the old seed password", async () => {
  const result = await request("/login");
  assert.equal(result.status, 200);
  assert.match(result.body, /تسجيل الدخول \| صلة تون/);
  assert.doesNotMatch(result.body, /حسابات البداية/);
  assert.equal((await request("/favicon.ico")).status, 200);
  assert.equal((await request("/icon.svg")).status, 200);
});
