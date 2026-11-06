#!/usr/bin/env node
// LOCAL PGlite preview only — mints a valid selahtone_session cookie.
// Creates a real auth_sessions row (jti) and prints the HS256 JWT to stdout.
// Usage:
//   PREVIEW_PGLITE_DIR=/tmp/pglite-preview AUTH_SECRET=<32+ secret> node scripts/local-pglite-session.cjs [userId] [ttlHours]
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const REPO = path.join(__dirname, '..');
const DB_DIR = process.env.PREVIEW_PGLITE_DIR || path.join(os.tmpdir(), 'pglite-preview');
const userId = String(process.argv[2] ?? '1');
const ttlHours = Number(process.argv[3] ?? '12');
const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32) {
  console.error('AUTH_SECRET (32+ chars) is required and must match the dev server');
  process.exit(2);
}
(async () => {
  const { SignJWT } = require(path.join(REPO, 'node_modules', 'jose'));
  const { PGlite } = require(path.join(REPO, 'node_modules', '@electric-sql', 'pglite'));
  const jti = randomBytes(32).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + ttlHours * 3600;
  const pg = new PGlite(DB_DIR);
  await pg.query('INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [jti, Number(userId), new Date(exp * 1000)]);
  await pg.close();
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));
  console.log(jwt);
})().catch((e) => {
  console.error('session mint FAILED:', e.message);
  process.exit(1);
});
