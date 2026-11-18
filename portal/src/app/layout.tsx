import "@fontsource-variable/public-sans";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOHAR Partner Portal",
  description: "Where a partner's staff run their MOHAR gold integration",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
