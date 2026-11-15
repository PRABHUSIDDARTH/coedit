// Fails if any production dependency has a licence outside the allowlist, or if any @tiptap-pro package is present.
// Run from a package dir (frontend/ or sync/): node <path>/check-licences.mjs
// Uses `pnpm licenses` when the package has a pnpm-lock.yaml (frontend), otherwise `npm ls` (sync).
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0",
  "CC0-1.0", "Unlicense", "Python-2.0", "PSF-2.0", "GPL-3.0-only", "GPL-3.0-or-later", "GPL-3.0",
  // LGPL-3.0 libraries may be combined with this GPL-3.0-or-later project. In practice this is the
  // prebuilt libvips binary that Next.js pulls in (optionally) for image optimisation.
  "LGPL-3.0-or-later", "LGPL-3.0-only", "LGPL-3.0",
  // caniuse-lite is browser-support data, attribution required, not code we modify.
  "CC-BY-4.0",
]);
const ALLOWED_EXPR = [/\bMIT\b/, /Apache-2\.0/, /GPL-3\.0/]; // for "(A OR B)" expressions

// Packages whose package.json omits the licence field but ship a licence file we have read.
const VERIFIED = { khroma: "MIT" };

/** name -> licence */
function fromPnpm() {
  const grouped = JSON.parse(execSync("pnpm licenses list --prod --json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const seen = new Map();
  for (const [licence, pkgs] of Object.entries(grouped)) for (const p of pkgs) seen.set(p.name, licence);
  return seen;
}

function fromNpm() {
  const tree = JSON.parse(execSync("npm ls --omit=dev --all --json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const seen = new Map();
  (function walk(deps = {}) {
    for (const [name, info] of Object.entries(deps)) {
      if (seen.has(name) || !info.version) continue;
      let licence = "UNKNOWN";
      try {
        const pkg = JSON.parse(readFileSync(join("node_modules", name, "package.json"), "utf8"));
        licence = typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? "UNKNOWN";
      } catch { /* nested or missing: keep UNKNOWN */ }
      seen.set(name, licence);
      walk(info.dependencies);
    }
  })(tree.dependencies);
  return seen;
}

const seen = existsSync("pnpm-lock.yaml") ? fromPnpm() : fromNpm();

const bad = [];
for (const [name, found] of seen) {
  const licence = VERIFIED[name] ?? found;
  if (name.startsWith("@tiptap-pro/")) bad.push(`${name}: paid Tiptap Pro package`);
  else if (!ALLOWED.has(licence) && !ALLOWED_EXPR.some((re) => re.test(licence))) bad.push(`${name}: ${licence}`);
}
if (bad.length) {
  console.error("Licence check FAILED:\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log(`Licence check OK (${seen.size} production packages)`);
