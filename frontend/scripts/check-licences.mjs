// Fails if any production dependency has a licence outside the allowlist, or if any @tiptap-pro package is present.
// Run from a package dir (frontend/ or sync/): node <path>/check-licences.mjs
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0",
  "CC0-1.0", "Unlicense", "Python-2.0", "GPL-3.0-only", "GPL-3.0-or-later", "GPL-3.0",
]);
const ALLOWED_EXPR = [/\bMIT\b/, /Apache-2\.0/, /GPL-3\.0/]; // for "(A OR B)" expressions

const tree = JSON.parse(execSync("npm ls --omit=dev --all --json", { encoding: "utf8" }));
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

const bad = [];
for (const [name, licence] of seen) {
  if (name.startsWith("@tiptap-pro/")) bad.push(`${name}: paid Tiptap Pro package`);
  else if (!ALLOWED.has(licence) && !ALLOWED_EXPR.some((re) => re.test(licence)))
    bad.push(`${name}: ${licence}`);
}
if (bad.length) {
  console.error("Licence check FAILED:\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log(`Licence check OK (${seen.size} production packages)`);
