import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/public-sans";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { DevPanel } from "@/components/DevPanel";
import { partner } from "@/lib/partner";
import "./globals.css";

export function generateMetadata(): Metadata {
  return {
    title: `${partner().name} · Gold Savings`,
    description: `${partner().description}, through MOHAR`,
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  const { colors, name } = partner();
  // The partner's colours override the theme's; everything else is shared.
  const theme = { "--color-bank": colors.main, "--color-bank-deep": colors.deep } as CSSProperties;
  return (
    <html lang="en" className="h-full antialiased" style={theme}>
      <body className="min-h-full">
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:items-start lg:gap-10 lg:py-10">
          <main className="w-full shrink-0 overflow-hidden rounded-[28px] border border-line bg-surface shadow-[0_1px_0_#d5ded8,0_24px_48px_-32px_rgba(18,38,30,0.35)] lg:sticky lg:top-10 lg:w-[400px] print:mx-auto print:border-0 print:shadow-none">
            {children}
          </main>
          <DevPanel partnerName={name} />
        </div>
      </body>
    </html>
  );
}
