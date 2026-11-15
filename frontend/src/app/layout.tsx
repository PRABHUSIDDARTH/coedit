import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Sora } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { THEME_COLOR } from "@/lib/theme-colors";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-mono-src", subsets: ["latin"], display: "swap" });
// Sora is the wordmark face; used only for large marketing headings.
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Coedit: write, calculate and think together", template: "%s · Coedit" },
  description:
    "One workspace for docs, sheets and a canvas, with an AI Council that debates your question and hands back a single answer.",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
  applicationName: "Coedit",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable} ${sora.variable}`}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
