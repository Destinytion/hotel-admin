import type { NextConfig } from "next";

const securityHeaders = [
  // The app is never shown inside another site's frame.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Browsers that have visited once will only use https from then on.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The container build sets this to get a small self-contained server.
  // Left off locally so `next start` keeps working for the test suites.
  output: process.env.BUILD_STANDALONE ? "standalone" : undefined,
  // Tailwind CSS v4 is compiled by its Turbopack loader.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The floating dev badge sits on top of the sidebar; errors still show.
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
