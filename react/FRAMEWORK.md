# The Unoverse SDK Framework — READ BEFORE EDITING SDK CODE

This package (`@gravity-platform/unoverse-react`) is a **fixed, generic renderer**.
It turns a neutral `UnoverseNode` tree into React. **It is not where UX lives.**

> **One sentence:** an author builds **any** interface in DATA (`rx/` definitions +
> the served theme) **without editing this SDK**. If you're reaching for the SDK to
> add a screen, a widget, a loader, a composer, an avatar row — **stop**. That is data.

---

## The two laws

**LAW 1 — Own zero style VALUES.**
No hex, no `px/rem/em`, no recipes in SDK source. The SDK only *resolves token names*
against a theme **fetched from the server** (`rx/styles` → `unoverse://theme/{name}`;
nothing is baked into the bundle). A style value or recipe goes in `rx/styles`.
_Enforced:_ `test/golden-rule.test.mjs` fails the build on any hex / unit literal.

**LAW 2 — Own zero UX SHAPE.**
A primitive renders **one generic element and nothing about a specific UX**. A pill,
a send button, a thinking indicator, a card, a welcome screen, an avatar-beside-content
row — these are **layouts**, composed in a **definition** from generic primitives. They
never become a primitive or per-UX config on a primitive.

---

## What lives where

| Concern | Home | Example |
| --- | --- | --- |
| Style **values** / recipes | `rx/styles/*` (served theme) | `prose.json`, `skeleton.json`, `keyframes.json`, color/space tokens |
| **Layout & composition** (any screen/widget) | `rx/` **definitions** | `templates/chatlayout/*.json`, `components/*/*.json` |
| Content (logo URL, copy, suggestions, icon glyphs) | definition `props` / served data | `chatlayout.json` props, a served icon set |
| The **generic interpreter** | this SDK | `styleToCss`, `keyframesCss`, `renderNode` dispatch |
| **Leaf primitives** | this SDK (closed set) | Box, Text, Image, Button, Input, Markdown, Skeleton |

If you can express it by combining existing primitives in a definition, it is **not** an
SDK change. That is true ~95% of the time.

---

## Two layers of `rx/` — tokens vs definitions (ENFORCED)

`rx/` has two layers, and **a raw value lives in exactly ONE place: the token layer.**

| Layer | Holds | Raw values? |
| --- | --- | --- |
| **`rx/styles/*`** — the TOKEN layer | the scales + recipes: `space` (one scale for spacing **and** sizes, Tailwind-style), `radius`, `color`, `font.*` (size/weight/lineHeight/tracking), `shadow`, `border.width`, `prose`/`skeleton`/`keyframes`/`icons` recipes | **YES** — this is the only place a `0.375rem` / `#d33131` lives |
| **`rx/templates/*`, `rx/components/*`** — the DEFINITION layer | layout trees that **reference tokens by name** | **NO** — `"width": "8"` (not `"2rem"`), `"radius": "lg"` (not `"0.75rem"`), `"color": "action.primary"` (not `#d33131`) |

**A raw `px`/`rem`/`em` or `#hex` in a definition fails the build** —
`apps/unoverse/server/src/runtime/definition-tokens.test.ts`. If you need a value that has
no token, **add/scale a token in `rx/styles`** (e.g. a new `space` step) and reference it —
never inline the value, and never invent a component-named token (`cardMin`, `tile`): use a
generic scale step. Sizes and spacing share the **`space`** scale (`width: "5"` = `1rem`…),
exactly like Tailwind's `w-5`/`p-5`.

This is the data-side twin of the golden rule: the SDK owns no values **and** definitions
own no values — both only reference the served token layer.

---

## SDK file structure (ENFORCED — don't blur it)

| File | Contains | NEVER contains |
| --- | --- | --- |
| **`src/render.tsx`** | the **dispatcher** only — `renderNode` walks the tree, handles control flow (`visibleWhen`, `Each`, slots), and **delegates** each `node.type` to a primitive component | **any raw element** (`<div>`, `<button>`, `<span>`, `<img>`, `<input>`, `<svg>`, `<style>`) or per-primitive logic |
| **`src/primitives.tsx`** | **EVERY** primitive — `Box`/`Text`/`Image`/`Button`/`Icon`/`Skeleton`/`Input`/`Markdown`/`Unknown` — plus the shared per-element chrome (hover/active/disabled) | a composite (Card/Loader/Composer); a baked style value |
| **`src/style.ts`** | the style + animation interpreter (`styleToCss`, `keyframesCss`, `cssDecls`) | a hex/px/rem literal |

**A raw DOM element in `render.tsx` fails the build** (`test/dispatcher-only.test.mjs`).
A hex/px/rem literal anywhere fails the build (`test/golden-rule.test.mjs`). These exist
because the split kept rotting — `Button` and its styling logic repeatedly leaked back
into the dispatcher. If you're writing a `<tag>`, it goes in `primitives.tsx`, full stop.

---

## The closed set of primitives

Structural: **Box / Stack / Row / Column** • **Each** (map an array) •
**ComponentSlot / Timeline** (store-backed).
Leaves: **Text • Image • Button • Input • Markdown • Skeleton**.

Each is the **irreducible** web realization of a neutral element — you cannot build a
text field out of `Box`+`Text`, so `Input → <input>` is a primitive. You *can* build a
chat composer out of `Box`+`Input`+`Button`, so a composer is **not** a primitive.

### Adding a primitive — all three gates, or it's data

1. **GENERIC** — unlocks a whole *class* of UX as data, not one screen. New primitives
   may only be **leaves at the tier of Text/Image** (a single irreducible element), never
   a composite (no `Loader`, `Card`, `ChatBubble`, `Composer`).
2. **NO VALUES** — every dimension/colour/timing is read from the served theme.
3. **NO POLICY** — it exposes neutral facts (`streaming`, `empty`); the *definition*
   decides what shows when (compose conditions with nested `visibleWhen`).

When the vocab can't express something, prefer **extending the generic interpreter once**
(a new `style` key, a new model projection, served keyframes) over adding a primitive.

---

## Violations gallery (all real, all reverted)

- ❌ A **`Loader`** primitive for thinking-dots. → ✅ generic `style.animation` + served
  `theme.keyframes`; the dots are `thinking-dots.json` (3 Boxes).
- ❌ **Icons + a send button baked into `InputView`** (a pill composer in the SDK). →
  ✅ `Input` stays a dumb field; compose the pill in a definition.
- ❌ A **`thinking` flag** computed in the renderer (UX policy). → ✅ expose `streaming`
  / `empty`; the definition composes the policy.
- ❌ Markdown **link/list/table styles hardcoded** in overrides. → ✅ served `theme.prose`.

The pattern is always the same: a *specific UX* crept into the *generic engine*. The fix
is always the same: move the shape to a **definition**, the values to **`rx/styles`**,
and leave the SDK a little dumber.

---

## How to build new UX (the actual workflow)

1. It's a **definition** (`rx/templates/...` or `rx/components/...`). Compose primitives.
2. Need a value/recipe? Add a **token** in `rx/styles` and reference it.
3. Genuinely blocked by the vocab? Re-read the gates above. Extend the **interpreter**
   generically, or add a **leaf** primitive — and document why it passed all three gates.
4. You should almost never touch `render.tsx`. If you are, prove it isn't data first.
