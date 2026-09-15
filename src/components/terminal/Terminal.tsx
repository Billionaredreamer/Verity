"use client";

/**
 * The Terminal — handover §3, the main Verity experience.
 *
 * Layout per §2: a large central conversation area with text input and
 * push-to-talk, and dynamic context cards beside the answer.
 *
 * The push-to-talk button is rendered DISABLED with an explicit reason rather
 * than as a button that silently does nothing. §12 forbids fake functionality
 * to complete the UI; voice is phase 6 (§11) and the honest thing is to show
 * where it will live and say it is not built.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationMessage, ContextCard } from "@/lib/schema/core";
import { DataStateBadge } from "@/components/ui/DataStateBadge";
import { Card, Empty, Pill, cn, toneClass } from "@/components/ui/primitives";

/** §3 "Representative queries", offered verbatim as starting points. */
const SUGGESTIONS = [
  "What are you seeing in SPY?",
  "Why did QQQ just drop?",
  "Is this move supported by options flow?",
  "Where is the major downside level?",
  "Is volatility expanding?",
  "What risks am I missing?",
] as const;

interface Entry {
  id: string;
  role: "user" | "verity";
  text: string;
  message?: ConversationMessage;
  engineLabel?: string;
  retrievalLog?: Array<{ key: string; state: string; ms: number; note?: string }>;
  error?: string;
}

export function Terminal() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, pending]);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || pending) return;

      const userEntry: Entry = { id: `u-${Date.now()}`, role: "user", text: trimmed };
      setEntries((prev) => [...prev, userEntry]);
      setInput("");
      setPending(true);

      try {
        const res = await fetch("/api/terminal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: trimmed }),
        });
        const data = await res.json();

        if (!res.ok) {
          setEntries((prev) => [
            ...prev,
            {
              id: `e-${Date.now()}`,
              role: "verity",
              text: "",
              error: data?.error ?? "Something went wrong.",
            },
          ]);
          return;
        }

        setEntries((prev) => [
          ...prev,
          {
            id: data.message.id,
            role: "verity",
            text: data.message.text,
            message: data.message,
            engineLabel: data.engineLabel,
            retrievalLog: data.retrievalLog,
          },
        ]);
      } catch {
        setEntries((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: "verity",
            text: "",
            error: "Could not reach Verity. Check that the server is running.",
          },
        ]);
      } finally {
        setPending(false);
      }
    },
    [pending],
  );

  return (
    <div className="mx-auto flex h-[calc(100vh-11rem)] max-w-5xl flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
        {entries.length === 0 && !pending && <Welcome onPick={ask} />}

        {entries.map((entry) =>
          entry.role === "user" ? (
            <UserBubble key={entry.id} text={entry.text} />
          ) : (
            <VerityAnswer key={entry.id} entry={entry} />
          ),
        )}

        {pending && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            Retrieving market context…
          </div>
        )}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={() => ask(input)}
        disabled={pending}
      />
    </div>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="pt-10">
      <h1 className="text-lg font-semibold tracking-tight">What matters right now?</h1>
      <p className="mt-1 max-w-xl text-sm text-muted">
        Ask about a ticker, the tape, options flow, gamma levels or your positions. Verity
        retrieves the relevant data first and answers from it — it will tell you when it
        cannot.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-ink"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-2xl rounded-card rounded-br-sm bg-raised px-3.5 py-2 text-sm text-ink">
        {text}
      </p>
    </div>
  );
}

function VerityAnswer({ entry }: { entry: Entry }) {
  if (entry.error) {
    return (
      <p className="rounded border border-unavailable/30 bg-unavailable/5 px-3 py-2 text-sm text-unavailable">
        {entry.error}
      </p>
    );
  }

  const m = entry.message;
  if (!m) return null;

  return (
    <article className="space-y-3">
      {m.cards.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {m.cards.map((card, i) => (
            <ContextCardView key={`${card.kind}-${i}`} card={card} />
          ))}
        </div>
      )}

      {/*
        §2 response style: fact first, interpretation second, uncertainty
        distinguished. These are three separate arrays from the reasoner, so
        the distinction survives into the layout rather than being a
        stylistic promise.
      */}
      {m.facts.length > 0 && (
        <Block label="What the data shows" tone="fact" items={m.facts} />
      )}
      {m.analysis.length > 0 && (
        <Block label="What it may mean" tone="analysis" items={m.analysis} />
      )}
      {m.uncertainty.length > 0 && (
        <Block label="What is uncertain" tone="uncertainty" items={m.uncertainty} />
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-2xs text-faint">
        {entry.engineLabel && <Pill tone="neutral">{entry.engineLabel}</Pill>}
        {entry.retrievalLog && entry.retrievalLog.length > 0 && (
          <details className="cursor-pointer">
            <summary className="hover:text-muted">
              Retrieved {entry.retrievalLog.length} source
              {entry.retrievalLog.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {entry.retrievalLog.map((r) => (
                <li key={r.key} className="tnum">
                  {r.key} · {r.state} · {r.ms}ms{r.note ? ` · ${r.note}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </article>
  );
}

function Block({
  label,
  tone,
  items,
}: {
  label: string;
  tone: "fact" | "analysis" | "uncertainty";
  items: string[];
}) {
  const accents: Record<typeof tone, string> = {
    fact: "border-l-ink/30",
    analysis: "border-l-accent/50",
    uncertainty: "border-l-warn/50",
  };
  return (
    <div className={cn("border-l-2 pl-3", accents[tone])}>
      <div className="mb-1 text-2xs uppercase tracking-wider text-faint">{label}</div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm leading-relaxed text-ink/90">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContextCardView({ card }: { card: ContextCard }) {
  return (
    <div className="rounded-card border border-line bg-surface p-2.5">
      <div className="flex items-start justify-between gap-1">
        <span className="truncate text-2xs uppercase tracking-wider text-faint">{card.title}</span>
        <DataStateBadge provenance={card.provenance} />
      </div>
      <div className={cn("tnum mt-1 truncate text-base font-medium", toneClass(card.tone))}>
        {card.value}
      </div>
      {card.detail && (
        <div className="mt-0.5 line-clamp-2 text-2xs leading-snug text-muted">{card.detail}</div>
      )}
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  return (
    <div className="border-t border-line pt-3">
      <div className="flex items-end gap-2 rounded-card border border-line bg-surface p-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={1}
          placeholder="Ask about a ticker, the tape, flow, gamma or your positions…"
          className="max-h-32 min-h-[2rem] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-ink outline-none placeholder:text-faint"
        />

        {/*
          Voice is handover §11 phase 6. Disabled with the reason stated, so
          nobody mistakes an unimplemented control for a broken one.
        */}
        <button
          type="button"
          disabled
          title="Push-to-talk arrives in phase 6 (voice). Not implemented yet."
          className="shrink-0 cursor-not-allowed rounded border border-line px-2 py-1.5 text-2xs uppercase tracking-wider text-faint opacity-50"
        >
          Hold to talk
        </button>

        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || value.trim().length === 0}
          className="shrink-0 rounded bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Ask
        </button>
      </div>
      <p className="mt-1.5 text-2xs text-faint">
        Verity answers from retrieved data and names its gaps. It does not predict prices or
        place trades.
      </p>
    </div>
  );
}
