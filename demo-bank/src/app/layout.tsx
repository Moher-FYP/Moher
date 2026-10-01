import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/public-sans";
import type { Metadata } from "next";
import { DevPanel } from "@/components/DevPanel";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo Bank · Gold Savings",
  description: "A partner bank offering fully allocated, Shariah-compliant gold through MOHAR",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:items-start lg:gap-10 lg:py-10">
          <main className="w-full shrink-0 overflow-hidden rounded-[28px] border border-line bg-surface shadow-[0_1px_0_#d5ded8,0_24px_48px_-32px_rgba(18,38,30,0.35)] lg:sticky lg:top-10 lg:w-[400px]">
            {children}
          </main>
          <DevPanel />
        </div>
      </body>
    </html>
  );
}
