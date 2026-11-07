import React from "react";
import { clsx } from "clsx";

/**
 * CFoh! wordmark. "CF" is upright, "oh!" is italic: the "oh" is the moment the
 * numbers finally make sense. Text-based so it inherits the theme colour.
 */
export function Wordmark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const sizes = { sm: "text-base", md: "text-lg", lg: "text-2xl", xl: "text-4xl" };
  return (
    <span className={clsx("inline-flex items-baseline font-extrabold tracking-wider leading-none select-none", sizes[size], className)} aria-label="CFoh!">
      <span>CF</span>
      <span className="inline-block italic -skew-x-[16deg] text-accent">oh!</span>
    </span>
  );
}

/** Square app mark used for the sidebar tile, favicon and app icon. */
export function LogoMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="CFoh!">
      <rect width="64" height="64" rx="14" fill="var(--accent, #4f46e5)" />
      <text x="6" y="41" fontFamily="var(--font-geist-sans), Inter, ui-sans-serif, system-ui, sans-serif" fontSize="18" fontWeight="800" fill="#fff" letterSpacing="0.8">
        CF
      </text>
      <text x="33" y="41" transform="skewX(-16)" style={{ transformOrigin: "33px 41px" }} fontFamily="var(--font-geist-sans), Inter, ui-sans-serif, system-ui, sans-serif" fontSize="18" fontWeight="800" fontStyle="italic" fill="#fff" letterSpacing="0.8">
        oh!
      </text>
    </svg>
  );
}
