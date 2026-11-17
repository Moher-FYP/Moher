import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The wallet partner runs from the same folder (pnpm dev:wallet), so it builds elsewhere.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
