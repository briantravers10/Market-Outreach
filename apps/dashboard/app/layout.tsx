import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Inter Tight for UI — the tighter widths give headings some authority at
 * small sizes without needing heavy weights. JetBrains Mono is used
 * deliberately for *data* (scores, counts, IDs, payloads) so numbers align in
 * columns and read as measurements rather than prose.
 */
const sans = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Market Outreach",
  description: "Internal prospecting system.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
