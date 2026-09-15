import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import "./globals.css";
import { Nav } from "@/components/shell/Nav";
import { MarketHeader } from "@/components/shell/MarketHeader";
import { DataSourceStrip } from "@/components/shell/DataSourceStrip";

export const metadata: Metadata = {
  title: "Verity — Trading Intelligence",
  description:
    "Market data, options flow, gamma exposure, position context and analysis in one workflow.",
};

/** Never cache the shell: the header carries live market state. */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-base">
        <header className="sticky top-0 z-30 border-b border-line bg-base/95 backdrop-blur">
          <div className="flex items-center gap-6 px-4 py-2">
            <Link href="/terminal" className="shrink-0 text-sm font-semibold tracking-tight">
              VERITY
            </Link>
            <Nav />
          </div>
          <div className="border-t border-line px-4 py-1.5">
            <Suspense
              fallback={<div className="h-5 text-2xs text-faint">Loading market header…</div>}
            >
              <MarketHeader />
            </Suspense>
          </div>
        </header>

        <main className="px-4 py-4">{children}</main>

        <footer className="border-t border-line px-4 py-3">
          <DataSourceStrip />
        </footer>
      </body>
    </html>
  );
}
