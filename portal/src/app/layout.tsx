import "@fontsource-variable/archivo";
import "@fontsource-variable/instrument-sans";
import "@fontsource/dm-serif-display";
import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOHAR Partner Portal",
  description: "Where a partner's staff run their MOHAR gold integration",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request, so each gets the nonce from proxy.ts (CSP).
  await connection();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
