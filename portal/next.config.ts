import type { NextConfig } from "next";

/**
 * The browser only ever talks to the portal's own origin. Requests to /portal/v1/* are passed
 * through to the MOHAR API, so the session cookie (Path=/portal, SameSite=Strict) and the
 * Origin check both work as if the API were on this origin, and the API stays on 127.0.0.1.
 */
const api = process.env.MOHAR_API_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/portal/v1/:path*", destination: `${api}/portal/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
