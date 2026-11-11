"use client";

import React, { useRef, useState } from "react";
import { Play } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * The product video. Nothing is downloaded until the visitor presses play;
 * until then they see the poster frame and a play button.
 */
export function DemoVideo({ src = "/cfoh-demo.mp4", poster = "/cfoh-demo-poster.jpg", length = "90 seconds" }: { src?: string; poster?: string; length?: string }) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <figure className="relative">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-[#f4f1ea] sm:rounded-3xl shadow-[0_40px_100px_-30px_rgba(16,24,40,0.45)]">
        {playing ? (
          <video ref={ref} className="absolute inset-0 h-full w-full" src={`${BASE}${src}`} poster={`${BASE}${poster}`} controls autoPlay playsInline onEnded={() => setPlaying(false)} />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 block h-full w-full" aria-label={`Play the CFoh! demo video, ${length}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${BASE}${poster}`} alt="CFoh! splitting a payment into running costs, pay, tax, profit, cushion and growth" className="absolute inset-0 h-full w-full object-cover" loading="eager" />
            <span className="absolute inset-0 bg-[#17162e]/25 transition-colors group-hover:bg-[#17162e]/15" />
            <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 whitespace-nowrap rounded-full bg-white py-2 pl-2 pr-5 text-sm font-semibold sm:gap-3 sm:py-3 sm:pl-3 sm:pr-6 sm:text-base text-[#17162e] shadow-2xl transition-transform group-hover:scale-105">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white sm:h-12 sm:w-12">
                <Play size={20} className="ml-0.5" fill="currentColor" />
              </span>
              Watch the demo
              <span className="hidden font-normal text-[#6b6860] sm:inline">· {length}</span>
            </span>
          </button>
        )}
      </div>
    </figure>
  );
}
