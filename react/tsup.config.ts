import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  // core is a dep (stays external); react is a peer; the rx/styles tokens get bundled in.
  external: ["react", "react-dom", "@gravity-platform/unoverse-core"],
});
