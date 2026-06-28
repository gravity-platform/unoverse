# Unoverse — JS channel SDKs

The Unoverse SDUI channel SDKs for JavaScript. Each channel embeds one of these to turn a
neutral Unoverse definition (`unoverse://components/{name}`) into native UI.

---

## ⛔ THE GOLDEN RULE: this SDK owns ZERO styles

**The SDK is a DUMB renderer.** It walks a neutral definition tree and maps the style vocab to
CSS by **resolving tokens** against a theme. It **authors nothing.**

**NEVER put any of this in SDK code:**
- ❌ hex colors (`#d33131`), `px`/`rem`/`em` literals, font sizes, letter-spacing, padding values
- ❌ a component "recipe" (e.g. "a primary button has 0.75rem padding and 0.05em tracking")
- ❌ anything that decides how something *looks*

**ALL styling is DATA in the MCP design system** — `GravityPlatform/apps/unoverse/rx/`:
- **`rx/styles/`** = design **tokens** only (colors, spacing, type, radius, shadow). The language.
- **`rx/atoms/` + `rx/components/`** = **definitions** (structure) that reference those tokens.

```
rx/styles (tokens) ──server resolves live──▶ unoverse://theme/{name}  ──fetch──┐
rx/ definitions (reference tokens) ──unoverse://components/{name}── fetch ──────┤──▶  SDK = resolve + paint (no values)
```

**Tokens are FETCHED, never BAKED.** The SDK ships the theme *shape* (`ResolvedTheme`) and
**zero values** — it fetches the resolved theme from the MCP server at runtime
(`client.readTheme` / `useUnoverseTheme`). There is **no `theme.generated.ts`** in this bundle.
A baked token snapshot would force a rebuild for every brand change — exactly what this avoids.
(See `UNOVERSE_SPEC.md` §2d-1 "Tokens are SERVED, not BAKED".)

If you are typing a style **value** into `react/src`, STOP — it belongs in `rx/`.
The ONLY legitimate styling code here is `styleToCss()`: it *resolves* neutral keys against the
theme. It interprets; it does not decide.

> A brand change must be an edit in `rx/` + a refresh — **never** an SDK edit/rebuild.
> (Why this rule exists: a button recipe got hardcoded here once. Never again.)

---

| Package | Channel | Notes |
|---|---|---|
| `@gravity-platform/unoverse-core` | (shared) | MCP client + merge-state store — the framework-agnostic brain |
| `@gravity-platform/unoverse-react` | Web | neutral definition → React/DOM (a dumb token-resolving renderer) |
| `@gravity-platform/unoverse-react-native` | iOS + Android | *(later)* |

> Native SDKs (Flutter / Swift / Kotlin) live in their **own repos** under the
> [gravity-platform org](https://github.com/orgs/gravity-platform/repositories) — different
> ecosystems can't share an npm monorepo.

The **platform side** (MCP server, workbench, definitions, design system `rx/`, node-gen) lives in
`GravityPlatform/apps/unoverse`. This repo is just the published client SDKs — consumed by the
workbench, the canvas, and external channels (like `gravity-client` is today).

## Develop

```bash
npm install
npm run build          # builds core then react (tsup → dist)
```

## Publish

Published to npm under `@gravity-platform`. Repo lives under the gravity-platform GitHub org.
