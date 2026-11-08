"use client";

import React, { useEffect, useState } from "react";
import { clsx } from "clsx";

/**
 * Fixed headline with a rotating final phrase (same rhythm as the Retention
 * Rules CSOS page: leave 420ms, enter 520ms, every 2.6s). Respects
 * prefers-reduced-motion by holding the first phrase.
 */
export function RotatingHeadline({ fixed, phrases, className }: { fixed: React.ReactNode; phrases: string[]; className?: string }) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"in" | "leaving" | "entering">("in");

  useEffect(() => {
    if (phrases.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setPhase("leaving");
      window.setTimeout(() => {
        setIndex((i) => (i + 1) % phrases.length);
        setPhase("entering");
        window.setTimeout(() => setPhase("in"), 520);
      }, 420);
    }, 2600);
    return () => window.clearInterval(id);
  }, [phrases.length]);

  const longest = phrases.reduce((a, b) => (b.length > a.length ? b : a), "");

  return (
    <h1 className={clsx("font-semibold tracking-tight", className)}>
      <span className="block">{fixed}</span>
      <span className="relative block text-accent" aria-live="polite">
        {/* Invisible longest phrase keeps the line height stable while phrases change. */}
        <span className="invisible block" aria-hidden="true">
          {longest}
        </span>
        <span
          className={clsx(
            "absolute inset-0 block transition-all duration-500 ease-out motion-reduce:transition-none",
            phase === "leaving" && "-translate-y-2 opacity-0",
            phase === "entering" && "translate-y-0 opacity-100 animate-[cfoh-rise_0.52s_ease-out]",
            phase === "in" && "translate-y-0 opacity-100",
          )}
        >
          {phrases[index]}
        </span>
      </span>
      <style>{`@keyframes cfoh-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </h1>
  );
}
