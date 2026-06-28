/**
 * GOLDEN RULE GUARD — the SDK owns ZERO style values.
 *
 * Scans the SDK source for authored design values (hex colors, px/rem/em unit
 * literals). All styling must be SERVED (theme tokens / theme.skeleton /
 * theme.prose ← rx/styles) and only RESOLVED here. This test exists because a
 * comment header was not enough: markdown styling kept creeping back into
 * render.tsx. If you're adding a value below, STOP and put it in rx/.
 *
 * Allowed: structural CSS keywords (flex/none/auto/block/column…) and "100%"
 * (layout, not a design token). Forbidden: #hex and any <number>px|rem|em.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sources(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
}

// #RGB / #RRGGBB / #RRGGBBAA, and <number> immediately followed by px|rem|em.
const FORBIDDEN = /#[0-9a-fA-F]{3,8}\b|\b\d*\.?\d+(px|rem|em)\b/;

test("SDK source authors no hex colors or px/rem/em literals (golden rule)", () => {
  const offenders = [];
  for (const file of sources(SRC)) {
    let inBlock = false; // skip comments — they document values (e.g. "→ 2rem") legitimately
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((raw, i) => {
        let line = raw;
        if (inBlock) {
          const end = line.indexOf("*/");
          if (end === -1) return;
          line = line.slice(end + 2);
          inBlock = false;
        }
        line = line.replace(/\/\*.*?\*\//g, "");
        const open = line.indexOf("/*");
        if (open !== -1) {
          line = line.slice(0, open);
          inBlock = true;
        }
        const lc = line.indexOf("//");
        if (lc !== -1) line = line.slice(0, lc);
        if (FORBIDDEN.test(line)) offenders.push(`${file.split("/src/")[1]}:${i + 1}  ${raw.trim()}`);
      });
  }
  assert.equal(
    offenders.length,
    0,
    `SDK must author no style values — move these to rx/styles (served via theme):\n${offenders.join("\n")}`,
  );
});
