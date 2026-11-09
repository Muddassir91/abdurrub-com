"use client";

import { useEffect } from "react";

/**
 * If an auth link (email confirmation, magic link, password reset, OAuth return)
 * lands on the marketing page instead of the app, forward it to the app with
 * the tokens intact so the session is picked up there.
 */
export const AUTH_URL_PATTERN = /(?:^|[#?&])(access_token|refresh_token|code|token_hash|error|error_code|type)=/;

export function AuthForwarder() {
  useEffect(() => {
    const { hash, search, origin } = window.location;
    if (!AUTH_URL_PATTERN.test(hash) && !AUTH_URL_PATTERN.test(search)) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    window.location.replace(`${origin}${base}/app/${search}${hash}`);
  }, []);
  return null;
}
