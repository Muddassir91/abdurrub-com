// Copies the static export (out/) into ../finance so GitHub Pages serves the
// app at https://abdurrub.com/finance/ alongside the portfolio site.
import { cpSync, existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const out = resolve(process.cwd(), "out");
const target = resolve(process.cwd(), "..", "finance");
if (!existsSync(out)) {
  console.error("No out/ directory. Run `npm run build` first.");
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(out, target, { recursive: true });
// GitHub Pages runs Jekyll by default, which drops directories starting with
// an underscore (Next.js emits _next/). The marker must live at the repo root.
writeFileSync(join(resolve(process.cwd(), ".."), ".nojekyll"), "");
console.log(`Copied static export to ${target}`);
