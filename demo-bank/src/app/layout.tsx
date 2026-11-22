import "@fontsource-variable/archivo";
import "@fontsource-variable/instrument-sans";
import "@fontsource/dm-serif-display";
import type { Metadata, Viewport } from "next";
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

export const viewport: Viewport = { themeColor: "#faf8f5" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  const { colors, name } = partner();
  // The partner's three colours override the kit's; everything else is shared.
  const theme = {
    "--color-primary": colors.primary,
    "--color-on-primary": colors.onPrimary,
    "--color-hero": colors.hero,
  } as CSSProperties;
  return (
    <html lang="en" className="h-full antialiased" style={theme}>
      <body className="min-h-full">
        <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col lg:flex-row lg:items-start lg:gap-14 lg:px-14 lg:py-12">
          {/* On a phone the app fills the screen; on a laptop it sits in a phone-sized frame. */}
          <main className="relative flex min-h-screen w-full shrink-0 flex-col bg-page lg:sticky lg:top-12 lg:min-h-[844px] lg:w-[390px] lg:overflow-hidden lg:rounded-[36px] lg:shadow-[inset_0_0_0_1px_var(--color-line),0_30px_60px_-40px_rgba(40,30,10,0.45)] print:static print:min-h-0 print:w-full print:shadow-none">
            {children}
          </main>
          <DevPanel partnerName={name} />
        </div>
      </body>
    </html>
  );
}
