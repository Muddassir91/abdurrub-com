import type { NextConfig } from "next";

// The app is a fully client-side single-page application. Data lives in a
// SQLite database (sql.js / WebAssembly) inside the browser, so the whole app
// can be exported as static files and hosted next to the portfolio site under
// https://abdurrub.com/cfoh/
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/cfoh";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
