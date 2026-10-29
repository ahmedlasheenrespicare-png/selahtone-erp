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
  experimental: {
    serverActions: {
      allowedOrigins: process.env.NODE_ENV === "development" ? ["*.e2b.app", ...extraOrigins] : extraOrigins,
    },
  },
};

export default nextConfig;
