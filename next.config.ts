import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Self-contained server build for the Docker image (ignored by Vercel).
  output: "standalone",
  env: {
    // Shown on the "Mises à jour" page (lib/updates/version.ts).
    KLEDG_BUILD_DATE: process.env.KLEDG_BUILD_DATE || new Date().toISOString(),
  },
  // Security headers of every response; the page CSP (with its nonce) is set by proxy.ts.
  async headers() {
    return STATIC_SECURITY_HEADERS;
  },
  poweredByHeader: false,
  // Former account pages, now in the settings area.
  async redirects() {
    return [
      { source: "/update-password", destination: "/settings/password", permanent: true },
      { source: "/signup", destination: "/settings/users/new", permanent: true },
    ];
  },
};

export default nextConfig;
