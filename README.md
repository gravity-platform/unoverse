# Unoverse — JS channel SDKs

The Unoverse SDUI channel SDKs for JavaScript. Each channel embeds one of these to turn a
neutral Unoverse definition (`unoverse://components/{name}`) into native UI.

| Package | Channel | Notes |
|---|---|---|
| `@gravity-platform/unoverse-core` | (shared) | MCP client + merge-state store — the framework-agnostic brain |
| `@gravity-platform/unoverse-react` | Web | neutral definition → React/DOM |
| `@gravity-platform/unoverse-react-native` | iOS + Android | *(later)* |

> Native SDKs (Flutter / Swift / Kotlin) live in their **own repos** under the
> [gravity-platform org](https://github.com/orgs/gravity-platform/repositories) — different
> ecosystems can't share an npm monorepo.

The **platform side** (MCP server, workbench, definitions, node-gen) lives in
`GravityPlatform/apps/unoverse`. This repo is just the published client SDKs — consumed by the
workbench, the canvas, and external channels (like `gravity-client` is today).

## Develop

```bash
npm install
npm run build          # builds core then react (tsup → dist)
```

## Publish

Published to npm under `@gravity-platform`. Repo lives under the gravity-platform GitHub org.
