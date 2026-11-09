import React from "react";
import { Reveal } from "./Reveal";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function Founder() {
  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto grid max-w-5xl items-center gap-10 px-5 py-20 sm:px-8 md:grid-cols-[280px_1fr]">
        <Reveal className="mx-auto w-full max-w-[280px]">
          <div className="relative">
            <div className="absolute -inset-3 -z-10 rounded-[2rem] bg-accent/15 blur-2xl" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${BASE}/founder.jpg`} alt="Muddassir Abdur Rub, founder of CFoh!" className="aspect-square w-full rounded-[2rem] object-cover shadow-card" />
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div className="text-xs font-semibold uppercase tracking-wider text-accent">A note from the founder</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">I built this because my wallet was empty every month.</h2>
          <div className="mt-5 space-y-4 text-[17px] leading-relaxed text-fg-muted">
            <p>When I was building my one-person marketing business, the biggest hurdle was not getting clients. It was that it did not matter how much I made. By the end of every month I had nothing left, because spending always quietly caught up with income.</p>
            <p>I thought I had a discipline problem. The real problem was that I could not &ldquo;see&rdquo; my money. One balance, a dozen subscriptions, a tax bill somewhere in the future, and no idea what I could actually pay myself. So every number looked spendable, and I spent it.</p>
            <p>What fixed it was not a spreadsheet. It was a set of habits: give every dollar a job the day it arrives, pay yourself on purpose, set tax aside before you can miss it, and decide on new costs with the numbers in front of you. I built CFoh! to run those habits for me.</p>
            <p>It worked for my business, so I am opening it up to anyone who earns well and still wonders where it all went.</p>
          </div>
          <div className="mt-6">
            <div className="font-semibold text-fg">Muddassir Abdur Rub</div>
            <div className="text-sm text-fg-muted">Founder, CFoh! and Retention Rules</div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
