/**
 * DISPATCHER-ONLY GUARD — render.tsx must contain NO raw element rendering.
 *
 * render.tsx is the dispatcher: it walks the tree and delegates each node.type to a
 * primitive component in primitives.tsx. EVERY primitive (every raw DOM element) lives
 * in primitives.tsx. This test fails the build if a raw element ever appears in
 * render.tsx — which is exactly how `Button` (and its styling logic) kept leaking back
 * into the dispatcher. If this fails: move the element to primitives.tsx and dispatch to it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// Raw DOM elements (lowercase JSX tag). Primitive *components* are PascalCase (<BoxView…>)
// and a <style> injection belongs with the element it styles (primitives), not here.
const RAW_ELEMENT = /<(div|span|button|img|input|svg|path|a|table|thead|tbody|tr|td|th|ul|ol|li|p|h[1-6]|style)\b/;

test("render.tsx is dispatch-only — no raw DOM elements (primitives live in primitives.tsx)", () => {
  const offenders = [];
  let inBlock = false; // skip comments — they may mention tags as examples
  readFileSync(join(SRC, "render.tsx"), "utf8")
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
      if (RAW_ELEMENT.test(line)) offenders.push(`render.tsx:${i + 1}  ${raw.trim()}`);
    });
  assert.equal(
    offenders.length,
    0,
    `render.tsx must only DISPATCH to primitive components — move these raw elements to primitives.tsx:\n${offenders.join("\n")}`,
  );
});
