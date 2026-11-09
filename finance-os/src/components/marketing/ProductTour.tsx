"use client";

import React, { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Pause, Play } from "lucide-react";

export interface TourScene {
  src: string;
  title: string;
  caption: string;
  /** CSS transform-origin for the slow zoom, e.g. "20% 30%". */
  focus?: string;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Auto-playing product tour: real screenshots of the app with a slow zoom and
 * a caption per scene, like a silent explainer video. Pauses on hover or tap.
 */
export function ProductTour({ scenes, interval = 5200, className, video }: { scenes: TourScene[]; interval?: number; className?: string; video?: { src: string; poster?: string } }) {
  const [showVideo, setShowVideo] = useState(false);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [reduced, setReduced] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (!playing || scenes.length < 2) return;
    timer.current = setTimeout(() => setI((n) => (n + 1) % scenes.length), interval);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [i, playing, scenes.length, interval]);

  const scene = scenes[i];
  return (
    <div className={clsx("group relative", className)} onMouseEnter={() => setPlaying(false)} onMouseLeave={() => setPlaying(true)}>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-3xl border border-border bg-[#0f1118] shadow-[0_40px_100px_-30px_rgba(16,24,40,0.45)]">
        {/* Browser chrome */}
        <div className="absolute inset-x-0 top-0 z-10 flex h-9 items-center gap-1.5 border-b border-white/10 bg-[#171a23] px-4">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-4 rounded-md bg-white/5 px-3 py-0.5 text-[11px] text-white/50">abdurrub.com/cfoh/app</span>
        </div>
        {video && showVideo && (
          <video className="absolute inset-x-0 top-9 z-20 h-[calc(100%-2.25rem)] w-full bg-black object-cover" src={`${BASE}${video.src}`} poster={video.poster ? `${BASE}${video.poster}` : undefined} controls autoPlay playsInline onEnded={() => setShowVideo(false)} />
        )}
        {video && !showVideo && (
          <button type="button" onClick={() => { setShowVideo(true); setPlaying(false); }} aria-label="Play the 30-second overview" className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full bg-white/95 py-2.5 pl-3 pr-5 text-sm font-semibold text-[#1c1a4f] shadow-2xl transition-transform hover:scale-105">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white"><Play size={16} className="ml-0.5" /></span>
            Watch the 30-second overview
          </button>
        )}
        {scenes.map((sc, idx) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={sc.src}
            src={`${BASE}${sc.src}`}
            alt={sc.title}
            loading={idx === 0 ? "eager" : "lazy"}
            style={{ transformOrigin: sc.focus ?? "50% 30%", transitionDuration: `${interval + 800}ms` }}
            className={clsx("absolute inset-x-0 top-9 w-full object-cover object-top transition-[opacity,transform] ease-linear", idx === i ? "opacity-100" : "opacity-0", idx === i && playing && !reduced ? "scale-[1.08]" : "scale-100")}
          />
        ))}
        {/* Caption */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-5 sm:p-7">
          <div key={i} className="animate-[cfoh-rise_0.6s_ease-out]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#c7c2ff]">
              {i + 1} / {scenes.length} · {scene.title}
            </div>
            <div className="mt-1 max-w-xl text-base font-medium leading-snug text-white sm:text-xl">{scene.caption}</div>
          </div>
        </div>
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause tour" : "Play tour"} className="absolute right-4 top-12 z-10 rounded-full bg-black/40 p-2 text-white opacity-0 transition-opacity group-hover:opacity-100">
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
      </div>
      {/* Progress dots */}
      <div className="mt-4 flex items-center justify-center gap-2">
        {scenes.map((sc, idx) => (
          <button key={sc.src} type="button" aria-label={`Scene ${idx + 1}: ${sc.title}`} onClick={() => setI(idx)} className={clsx("h-1.5 rounded-full transition-all", idx === i ? "w-8 bg-accent" : "w-2 bg-border-strong hover:bg-fg-faint")} />
        ))}
      </div>
    </div>
  );
}
