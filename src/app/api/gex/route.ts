/**
 * GEX endpoint (§5). Returns the full-chain snapshot and, separately, the
 * 0DTE snapshot — which is null when nothing expires today rather than
 * silently widened to the next expiration.
 */

import { NextResponse } from "next/server";
import { providers } from "@/lib/providers/registry";
import { computeGex, computeZeroDteGex, describeGex } from "@/lib/engines/gammaEngine";
import { upcomingExpirations } from "@/lib/util/dates";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = (params.get("ticker") ?? "SPY").toUpperCase();

  if (!/^[A-Z]{1,6}$/.test(raw)) {
    return NextResponse.json({ error: "Invalid ticker." }, { status: 400 });
  }

  const expirationCount = Math.min(8, Math.max(1, Number(params.get("expirations") ?? 4) || 4));

  try {
    const chain = await providers().options.getChain(raw, upcomingExpirations(expirationCount));
    const full = computeGex(chain.data);
    const zeroDte = computeZeroDteGex(chain.data);

    return NextResponse.json({
      ticker: raw,
      spot: chain.data.spot,
      full,
      zeroDte,
      narrative: describeGex(full),
      provenance: chain.provenance,
    });
  } catch (err) {
    console.error("[gex] computation failed", err);
    return NextResponse.json(
      {
        ticker: raw,
        full: null,
        zeroDte: null,
        narrative: [],
        provenance: {
          state: "UNAVAILABLE",
          source: "options",
          observedAt: new Date().toISOString(),
          retrievedAt: new Date().toISOString(),
          delaySeconds: null,
          note: err instanceof Error ? err.message : "Options chain is unavailable.",
        },
      },
      { status: 200 },
    );
  }
}
