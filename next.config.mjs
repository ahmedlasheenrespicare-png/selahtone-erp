// Same-origin Server Actions work without an allowlist. Add exact proxy hosts only if needed.
const extraOrigins = (process.env.SERVER_ACTION_ALLOWED_ORIGINS ?? "")
  .split(",").map((host) => host.trim()).filter(Boolean);
if (extraOrigins.some((host) => !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(host))) {
  throw new Error("SERVER_ACTION_ALLOWED_ORIGINS must contain exact hosts, without schemes or wildcards");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["*.e2b.app"],
  // المعاينة المحلية عبر PGlite تحمّل حزم WASM/ESM اختيارية في وقت التشغيل — تُستثنى من الحزمة حتى لا يفسد Webpack استيرادات .wasm.
  // لا يؤثر ذلك على مسار الإنتاج (لا تُضبط PRISMA_PGLITE_DIR هناك).
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/client/runtime",
    "@prisma/client/wasm",
    ".prisma/client",
    ".prisma/client/wasm",
    "@electric-sql/pglite",
    "pglite-prisma-adapter",
  ],
  experimental: {
    serverActions: {
      allowedOrigins: process.env.NODE_ENV === "development" ? ["*.e2b.app", ...extraOrigins] : extraOrigins,
    },
  },
};

export default nextConfig;
