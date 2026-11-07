"use client";

import { useEffect } from "react";

/** Registers the service worker so the app installs to the home screen and opens offline. */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch((e) => console.warn("Service worker registration failed", e));
  }, []);
  return null;
}
