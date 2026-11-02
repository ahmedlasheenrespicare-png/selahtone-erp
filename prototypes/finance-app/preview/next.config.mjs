/** TEST-ONLY development configuration; never copied into production. */
export default {
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev", "127.0.0.1", "localhost"],
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
      allowedOrigins: ["*.e2b.app", "*.e2b.dev", "127.0.0.1:4187", "localhost:4187"],
    },
  },
  serverExternalPackages: ["@electric-sql/pglite", "pglite-prisma-adapter"],
};
