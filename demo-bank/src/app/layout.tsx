import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo Bank · Gold Savings",
  description: "Mock partner bank integrating MOHAR tokenized gold through the SDK",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
