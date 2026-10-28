/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // يسمح بالدخول من معاينة السحابة ومن الدومين النهائي
      allowedOrigins: [
        "localhost:3000",
        "*.e2b.app",
        "*.netlify.app",
        "selahtone.com",
        "www.selahtone.com",
      ],
    },
  },
};

export default nextConfig;
