/**
 * Options flow endpoint (§4).
 *
 * Query parsing lives in src/lib/util/flowQuery.ts — route modules may only
 * export handlers, and the parsing is worth testing on its own.
 */

import { NextResponse } from "next/server";
import { providers } from "@/lib/providers/registry";
import { parseFlowFilters, parseLimit } from "@/lib/util/flowQuery";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = parseFlowFilters(params);
  const limit = parseLimit(params.get("limit"));

  try {
    const result = await providers().options.getFlow(filters, limit);
    return NextResponse.json({
      events: result.data,
      provenance: result.provenance,
      filters,
    });
  } catch (err) {
    console.error("[flow] retrieval failed", err);
    // §10: an outage is reported as one. No cached or substituted rows.
    return NextResponse.json({
      events: [],
      provenance: {
        state: "UNAVAILABLE",
        source: "options",
        observedAt: new Date().toISOString(),
        retrievedAt: new Date().toISOString(),
        delaySeconds: null,
        note: err instanceof Error ? err.message : "Flow provider is unavailable.",
      },
      filters,
    });
  }
}
