import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The wallet partner runs from the same folder (pnpm dev:wallet), so it builds elsewhere.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: {
    serverActions: {
      // Server actions accept 1 MB by default; the sign-up form takes a CNIC photo of up to
      // 5 MB (lib/onboarding.ts), plus the other fields.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
