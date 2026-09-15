/**
 * Terminal question endpoint.
 *
 * The full §8 data path in one handler: normalize → analyze → assemble
 * context → reason → respond. The model is never given the question without
 * the context package, and never given market endpoints of its own.
 */

import { NextResponse } from "next/server";
import { assembleContext, buildContextCards, extractTicker } from "@/lib/context/contextEngine";
import { reasoner } from "@/lib/ai/reasoner";
import { UNIVERSE } from "@/lib/providers/mock/universe";
import type { ConversationMessage } from "@/lib/schema/core";

export const dynamic = "force-dynamic";

/** Bounded so a pasted document cannot become a prompt. */
const MAX_QUESTION_LENGTH = 500;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { question, ticker } = (body ?? {}) as { question?: unknown; ticker?: unknown };

  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ error: "A question is required." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `Questions are limited to ${MAX_QUESTION_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const trimmed = question.trim();
  const known = UNIVERSE.map((u) => u.ticker);
  const explicit = typeof ticker === "string" && ticker.trim() ? ticker.trim().toUpperCase() : null;
  const resolvedTicker = explicit ?? extractTicker(trimmed, known);

  try {
    // TODO(auth): replace with the authenticated user once auth lands (§11 phase 1).
    const userId = "local-user";

    const pkg = await assembleContext({ question: trimmed, ticker: resolvedTicker, userId });
    const answer = await reasoner().answer(pkg);

    const message: ConversationMessage = {
      id: `msg-${Date.now()}`,
      role: "verity",
      text: answer.text,
      cards: buildContextCards(pkg),
      facts: answer.facts,
      analysis: answer.analysis,
      uncertainty: answer.uncertainty,
      tickerContext: resolvedTicker,
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({
      message,
      engine: answer.engine,
      engineLabel: answer.engineLabel,
      // §10: "Log analytics inputs/outputs sufficiently for debugging."
      // Returned to the client so the retrieval trace is inspectable in the UI.
      retrievalLog: pkg.retrievalLog,
    });
  } catch (err) {
    console.error("[terminal] request failed", err);
    return NextResponse.json(
      { error: "Verity could not assemble market context for that question." },
      { status: 500 },
    );
  }
}
