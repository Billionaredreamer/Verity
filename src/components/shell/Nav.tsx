"use client";

/**
 * Primary navigation — the six sections from handover §2, in the order the
 * handover lists them. The order is the product's priority claim (§12: "Core
 * priority is Terminal + Flow + GEX") and should not be rearranged casually.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/primitives";

const SECTIONS = [
  { href: "/terminal", label: "Terminal", hint: "Conversational market copilot" },
  { href: "/flow", label: "Flow", hint: "Unusual options activity" },
  { href: "/gex", label: "GEX", hint: "Gamma exposure and key levels" },
  { href: "/markets", label: "Markets", hint: "Regime, sectors, breadth, events" },
  { href: "/signals", label: "Signals", hint: "Explainable setups" },
  { href: "/portfolio", label: "Portfolio", hint: "Read-only positions and risk" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex items-center gap-0.5">
      {SECTIONS.map((s) => {
        const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.href}
            href={s.href}
            title={s.hint}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-raised font-medium text-ink"
                : "text-muted hover:bg-raised/60 hover:text-ink",
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
